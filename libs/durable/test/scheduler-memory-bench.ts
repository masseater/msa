import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import modelsModule from "@msa/ai/models";
import contextModule from "@msa/chord/context";
import { Console, Effect } from "effect";

import harnessModuleModule from "../src/harness/harness.ts";
import type harnessTypes from "../src/harness/index.types.ts";
import type durableTypes from "../src/index.types.ts";
import durableKit from "./durable-kit.ts";
import retainedBytes from "./heap-retained.ts";
import support from "./support.ts";

const { createModels } = modelsModule;

const { BACKGROUND_CONTEXT: context } = contextModule;

const { durable, harness: harnessModule, sqliteNode: node } = durableKit;

const { defineExtension, defineTask } = durable;
const { openNodeSqliteStorage } = node;
const { Harness, createRegistry } = harnessModule;
const { SCHEDULER_INDEX_SIZES } = harnessModuleModule;

const { awaited, joinPath, makeTempDir, removeDir, toJsonText } = support;

const waiting = new Map<string, () => void>();
const Hold = defineTask<{ name: string }, { phase: "hold" }, null>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "hold" }),
  name: "bench.hold",
  phases: {
    hold: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { promise, resolve } = Promise.withResolvers<void>();
          waiting.set(task.input.name, resolve);
          yield* awaited(promise);
          yield* awaited(
            runtime.commit(
              () => ({ outcome: { result: null, status: "completed" }, status: "terminal" }),
              ctx,
            ),
          );
        }),
      ),
  },
  version: 1,
});

const release = Effect.fn("release")(function* (name: string) {
  let resume = waiting.get(name);
  while (resume === undefined) {
    yield* Effect.sleep(1);
    resume = waiting.get(name);
  }
  resume();
  waiting.delete(name);
});

type Sizes = Record<
  "live" | "settled" | "edges" | "below" | "roots" | "unloaded" | "dropQueue",
  number
>;

const countingStorage = Effect.fn("countingStorage")(function* (directory: string) {
  const storage = yield* awaited(openNodeSqliteStorage(joinPath(directory, "session.sqlite")));
  const reads = { count: 0 };
  const task = storage.task.bind(storage);
  const conversation = storage.conversation.bind(storage);
  storage.task = (id, readContext) => {
    reads.count++;
    return task(id, readContext);
  };
  storage.conversation = (id, readContext) => {
    reads.count++;
    return conversation(id, readContext);
  };
  return { reads, storage };
});

const subagentCycle = Effect.fn("subagentCycle")(function* (
  harness: harnessTypes.Harness,
  root: durableTypes.Conversation,
  parent: durableTypes.TaskId,
  n: number,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { tool, inner, child } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const toolInner = yield* awaited(
              tx.createTask(
                Hold,
                { name: `tool${n}` },
                { ownership: { kind: "task", taskId: parent } },
              ),
            );
            const childInner = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: toolInner } }),
            );
            const innerInner = yield* awaited(
              tx.createTask(
                Hold,
                { name: `inner${n}` },
                { conversationId: childInner.id, ownership: { kind: "conversation" } },
              ),
            );
            return { child: childInner.id, inner: innerInner, tool: toolInner };
          }),
        ),
      context,
    ),
  );
  yield* release(`inner${n}`);
  yield* release(`tool${n}`);
  yield* awaited(harness.waitForTask(inner as durableTypes.TaskId, context));
  yield* awaited(harness.waitForTask(tool as durableTypes.TaskId, context));
  return child;
});

const run = Effect.fn("run")(function* (cycles: number) {
  const directory = yield* makeTempDir("msa-durable-memory-bench-");
  return yield* Effect.gen(function* () {
    const { storage, reads } = yield* countingStorage(directory);
    const registry = createRegistry();
    registry.install(defineExtension({ name: "bench", tasks: [Hold] }));
    const harness = yield* awaited(
      Harness.open(storage, { models: createModels(), registry }, context),
    );
    const root = yield* awaited(harness.root(context));
    harness.resume();
    const parent = yield* awaited(
      root.commit(
        (tx) => tx.createTask(Hold, { name: "parent" }, { ownership: { kind: "conversation" } }),
        context,
      ),
    );
    const heapBefore = yield* retainedBytes();
    let first: durableTypes.ConversationId | undefined;
    const started = performance.now();
    for (const n of Array.from({ length: cycles }, (_, i) => i)) {
      const child = yield* subagentCycle(harness, root, parent, n);
      first ??= child;
    }
    const ms = Math.round(performance.now() - started);
    const heapAfter = yield* retainedBytes();
    const sizes = (harness as unknown as Record<symbol, Sizes>)[SCHEDULER_INDEX_SIZES]!;
    const readsBefore = reads.count;
    const old = (yield* awaited(harness.conversation(first!, context)))!;
    const late = yield* awaited(
      old.commit(
        (tx) => tx.createTask(Hold, { name: "late" }, { ownership: { kind: "conversation" } }),
        context,
      ),
    );
    yield* release("late");
    yield* awaited(harness.waitForTask(late, context));
    const lateReads = reads.count - readsBefore;
    yield* release("parent");
    yield* awaited(harness.waitForTask(parent, context));
    yield* awaited(harness.close(context));
    return { heap: heapAfter - heapBefore, lateReads, ms, sizes };
  }).pipe(Effect.ensuring(removeDir(directory)));
});

const cycles = process.argv.slice(2).map(Number);
Effect.runSync(
  Console.log(
    "cycles | ms     | settled | edges  | below | heap growth             | reads for a later message",
  ),
);

const main = Effect.gen(function* () {
  for (const n of cycles.length > 0 ? cycles : [1000, 10000]) {
    const { ms, sizes, heap, lateReads } = yield* run(n);
    yield* Console.log(
      `${String(n).padEnd(6)} | ${String(ms).padEnd(6)} | ${String(sizes.settled).padEnd(7)} | ${String(sizes.edges).padEnd(6)} | ${String(sizes.below).padEnd(5)} | ${`${(heap / 1024 / 1024).toFixed(1)} MiB, ${Math.round(heap / n)} B/cycle`.padEnd(23)} | ${lateReads}`,
    );
    if (sizes.settled > 0 || sizes.edges > 1)
      throw new Error(`ownership indexes grew with history: ${yield* toJsonText(sizes)}`);
  }
});

NodeRuntime.runMain(main);
