import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { SCHEDULER_INDEX_SIZES } from "../src/harness/harness.ts";
import { createRegistry, Harness } from "../src/harness/index.ts";
import {
  type Conversation,
  type ConversationId,
  defineExtension,
  defineTask,
  type TaskId,
} from "../src/index.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { toJsonText, awaited } from "./effect-support.ts";
import { retainedBytes } from "./heap-retained.ts";
import { joinPath } from "./platform-support.ts";

const waiting = new Map<string, () => void>();
const Hold = defineTask<{ name: string }, { phase: "hold" }, null>({
  name: "bench.hold",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    hold: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(
            new Promise<void>((resolve) => {
              waiting.set(task.input.name, resolve);
            }),
          );
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
              ctx,
            ),
          );
        }),
      ),
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
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
  return { storage, reads };
});

const subagentCycle = Effect.fn("subagentCycle")(function* (
  harness: Harness,
  root: Conversation,
  parent: TaskId,
  n: number,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { tool, inner, child } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const tool = yield* awaited(
              tx.createTask(
                Hold,
                { name: `tool${n}` },
                { ownership: { kind: "task", taskId: parent } },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: tool } }),
            );
            const inner = yield* awaited(
              tx.createTask(
                Hold,
                { name: `inner${n}` },
                { ownership: { kind: "conversation" }, conversationId: child.id },
              ),
            );
            return { tool, inner, child: child.id };
          }),
        ),
      context,
    ),
  );
  yield* release(`inner${n}`);
  yield* release(`tool${n}`);
  yield* awaited(harness.waitForTask(inner as TaskId, context));
  yield* awaited(harness.waitForTask(tool as TaskId, context));
  return child;
});

const run = Effect.fn("run")(function* (cycles: number) {
  const directory = mkdtempSync(joinPath(tmpdir(), "msa-durable-memory-bench-"));
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
    let first: ConversationId | undefined;
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
    return { ms, sizes, heap: heapAfter - heapBefore, lateReads };
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        rmSync(directory, { recursive: true, force: true });
      }),
    ),
  );
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
