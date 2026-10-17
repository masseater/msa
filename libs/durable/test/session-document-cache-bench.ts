/**
 * Session document cache benchmark. A Harness on SQLite creates N conversations and runs one short task in each, as a
 * long-running agent with subagents does; then, at a few retention settings, reports the documents left in the cache,
 * the bytes live objects retain (from heap snapshots) per conversation, and the cost of reading a document of an old conversation again.
 *
 *   node --conditions=source --experimental-strip-types test/session-document-cache-bench.ts [N...]
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@msa/ai/models";
import { BACKGROUND_CONTEXT as context } from "@msa/chord/context";

import {
  type ConversationId,
  createRegistry,
  defineExtension,
  defineTask,
  Harness,
  LiveDoc,
  UsageDoc,
} from "../src/index.ts";
import type { SessionImpl } from "../src/session/session.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { retainedBytes } from "./heap-retained.ts";

/** Writes `msa.usage` of its conversation once, then completes. */
const Work = defineTask<null, { phase: "work" }, null>({
  name: "bench.work",
  version: 1,
  initial: () => ({ phase: "work" }),
  phases: {
    work: (_task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(async (tx) => {
          (await tx.doc(UsageDoc, runtime.conversationId)).tools["bench"] = { input: 1 } as never;
          return { status: "terminal", outcome: { status: "completed", result: null } };
        }, ctx),
      ),
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

async function openBenchHarness(directory: string, documentRetentionMs: number) {
  const storage = await openNodeSqliteStorage(join(directory, "session.sqlite"));
  const registry = createRegistry();
  registry.install(defineExtension({ name: "bench", tasks: [Work] }));
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry, settings: { documentRetentionMs } },
    context,
  );
  harness.resume();
  return harness;
}

// A cycle runs one task in a new ownerless conversation; `seen.first` is the first of them.
function cycler(harness: Harness) {
  const seen: { first?: ConversationId } = {};
  const cycle = async (): Promise<void> => {
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );
    seen.first ??= conversation.id;
    const task = await conversation.commit(
      (tx) => tx.createTask(Work, null, { ownership: { kind: "conversation" } }),
      context,
    );
    const settled = await harness.waitForTask(task, context);
    if (settled.state.outcome.status !== "completed")
      throw new Error(`task ${task} ${settled.state.outcome.status}`);
  };
  return { seen, cycle };
}

async function run(conversations: number, documentRetentionMs: number) {
  const directory = mkdtempSync(join(tmpdir(), "msa-durable-doc-cache-bench-"));
  try {
    const harness = await openBenchHarness(directory, documentRetentionMs);
    const { seen, cycle } = cycler(harness);
    // Warm up first: compiled code and storage caches would otherwise count as growth.
    for await (const _ of Array.from({ length: 200 })) await cycle();
    await (harness as unknown as SessionImpl).readOnLine(async () => {});
    const heapBefore = await retainedBytes();
    const started = performance.now();
    for await (const _ of Array.from({ length: conversations })) await cycle();
    const ms = Math.round(performance.now() - started);
    // Wait past a short retention without committing, so only the timer can evict; then let its job run.
    if (documentRetentionMs > 0 && documentRetentionMs < 1_000) {
      await new Promise((resolve) => {
        setTimeout(resolve, documentRetentionMs * 4);
      });
    }
    await (harness as unknown as SessionImpl).readOnLine(async () => {});
    const heap = (await retainedBytes()) - heapBefore;
    const cached = (harness as unknown as SessionImpl).documentCacheSizes.cached;
    // One read of an old conversation's document: from the cache, or from storage after eviction.
    const readStarted = performance.now();
    for await (const _ of Array.from({ length: 100 }))
      await harness.snapshot(LiveDoc, seen.first!, context);
    const readUs = Math.round(((performance.now() - readStarted) / 100) * 1000);
    await harness.close(context);
    return { ms, heap, cached, readUs };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const sizes = process.argv.slice(2).map(Number);
console.log(
  "conversations | retention   | ms     | cached docs | retained bytes        | old-doc read",
);
for await (const n of sizes.length > 0 ? sizes : [1000, 5000]) {
  for await (const [label, retention] of [
    ["infinite", Number.MAX_SAFE_INTEGER],
    ["10 min", 600_000],
    ["50 ms", 50],
    ["0", 0],
  ] as const) {
    const { ms, heap, cached, readUs } = await run(n, retention);
    console.log(
      `${String(n).padEnd(13)} | ${label.padEnd(11)} | ${String(ms).padEnd(6)} | ${String(cached).padEnd(11)} | ${`${(heap / 1024 / 1024).toFixed(1)} MiB, ${Math.round(heap / n)} B/conv`.padEnd(21)} | ${readUs} µs`,
    );
  }
}
