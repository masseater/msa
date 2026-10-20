import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { Harness, createRegistry } from "../src/harness/index.ts";
import {
  type ConversationId,
  LiveDoc,
  UsageDoc,
  defineExtension,
  defineTask,
} from "../src/index.ts";
import type { SessionImpl } from "../src/session/session.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import retainedBytes from "./heap-retained.ts";
import support from "./support.ts";

const { awaited, joinPath, makeTempDir, removeDir } = support;

const Work = defineTask<null, { phase: "work" }, null>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "work" }),
  name: "bench.work",
  phases: {
    work: (_task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(
          (tx) =>
            Effect.runPromise(
              Effect.gen(function* () {
                (yield* awaited(tx.doc(UsageDoc, runtime.conversationId))).tools["bench"] = {
                  input: 1,
                } as never;
                return { outcome: { result: null, status: "completed" }, status: "terminal" };
              }),
            ),
          ctx,
        ),
      ),
  },
  version: 1,
});

const openBenchHarness = Effect.fn("openBenchHarness")(function* (
  directory: string,
  documentRetentionMs: number,
) {
  const storage = yield* awaited(openNodeSqliteStorage(joinPath(directory, "session.sqlite")));
  const registry = createRegistry();
  registry.install(defineExtension({ name: "bench", tasks: [Work] }));
  const harness = yield* awaited(
    Harness.open(
      storage,
      { models: createModels(), registry, settings: { documentRetentionMs } },
      context,
    ),
  );
  harness.resume();
  return harness;
});

function cycler(harness: Harness) {
  const seen: { first?: ConversationId } = {};
  const cycle = (): Promise<void> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const conversation = yield* awaited(
          harness.createConversation({ ownership: { kind: "ownerless" } }, context),
        );
        seen.first ??= conversation.id;
        const task = yield* awaited(
          conversation.commit(
            (tx) => tx.createTask(Work, null, { ownership: { kind: "conversation" } }),
            context,
          ),
        );
        const settled = yield* awaited(harness.waitForTask(task, context));
        if (settled.state.outcome.status !== "completed")
          throw new Error(`task ${task} ${settled.state.outcome.status}`);
      }),
    );
  return { cycle, seen };
}

const run = Effect.fn("run")(function* (conversations: number, documentRetentionMs: number) {
  const directory = yield* makeTempDir("msa-durable-doc-cache-bench-");
  return yield* Effect.gen(function* () {
    const harness = yield* openBenchHarness(directory, documentRetentionMs);
    const { seen, cycle } = cycler(harness);
    for (const _ of Array.from({ length: 200 })) yield* awaited(cycle());
    yield* awaited((harness as unknown as SessionImpl).readOnLine(() => Promise.resolve()));
    const heapBefore = yield* retainedBytes();
    const started = performance.now();
    for (const _ of Array.from({ length: conversations })) yield* awaited(cycle());
    const ms = Math.round(performance.now() - started);
    if (documentRetentionMs > 0 && documentRetentionMs < 1_000) {
      yield* Effect.sleep(documentRetentionMs * 4);
    }
    yield* awaited((harness as unknown as SessionImpl).readOnLine(() => Promise.resolve()));
    const heap = (yield* retainedBytes()) - heapBefore;
    const cached = (harness as unknown as SessionImpl).documentCacheSizes.cached;
    const readStarted = performance.now();
    for (const _ of Array.from({ length: 100 }))
      yield* awaited(harness.snapshot(LiveDoc, seen.first!, context));
    const readUs = Math.round(((performance.now() - readStarted) / 100) * 1000);
    yield* awaited(harness.close(context));
    return { cached, heap, ms, readUs };
  }).pipe(Effect.ensuring(removeDir(directory)));
});

const sizes = process.argv.slice(2).map(Number);
Effect.runSync(
  Console.log(
    "conversations | retention   | ms     | cached docs | retained bytes        | old-doc read",
  ),
);

const main = Effect.gen(function* () {
  for (const n of sizes.length > 0 ? sizes : [1000, 5000]) {
    for (const [label, retention] of [
      ["infinite", Number.MAX_SAFE_INTEGER],
      ["10 min", 600_000],
      ["50 ms", 50],
      ["0", 0],
    ] as const) {
      const { ms, heap, cached, readUs } = yield* run(n, retention);
      yield* Console.log(
        `${String(n).padEnd(13)} | ${label.padEnd(11)} | ${String(ms).padEnd(6)} | ${String(cached).padEnd(11)} | ${`${(heap / 1024 / 1024).toFixed(1)} MiB, ${Math.round(heap / n)} B/conv`.padEnd(21)} | ${readUs} µs`,
      );
    }
  }
});

NodeRuntime.runMain(main);
