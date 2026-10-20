import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { conversationViews } from "../src/harness/view.ts";
import harnessStorageFailureSupport from "./harness-storage-failure-support.ts";
import support from "./support.ts";

const { started } = harnessStorageFailureSupport;
const { awaited, context } = support;

const reportsThrowingCommit = Effect.gen(function* () {
  const storage = new MemoryStorage();
  const { harness, root, reports } = yield* started(storage);
  const seen: string[] = [];
  harness.subscribeCommits(() => {
    throw new Error("commit listener");
  });
  harness.subscribeCommits(() => seen.push("commit"));
  harness.subscribeClose(() => {
    throw new Error("close listener");
  });
  harness.subscribeClose(() => seen.push("close"));
  yield* awaited(
    expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined(),
  );
  yield* awaited(harness.close(context));
  expect(seen).toEqual(["commit", "close"]);
  expect(reports.map(String)).toEqual(["Error: commit listener", "Error: close listener"]);
});

describe("listener and report errors", () => {
  it("reports a throwing commit or close listener and runs the others; the commit stands", () =>
    Effect.runPromise(reportsThrowingCommit));
});

const keepsFeedingOther = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root, reports } = yield* started(new MemoryStorage());
  const views = conversationViews(harness);
  const failure = new Error("observer broke");
  yield* awaited(
    views.attach(
      root.id,
      () =>
        Promise.resolve({
          closeSession: () => {},
          publication: () => {
            throw failure;
          },
        }),
      context,
    ),
  );
  const watch = yield* awaited(root.watch(context));
  const seen: unknown[] = [];
  watch.start((value) => {
    seen.push(value);

    return Promise.resolve();
  });
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  const delivered = (): Promise<void> =>
    runPromise(
      Effect.gen(function* () {
        if (seen.length > 0) return;
        yield* Effect.sleep(1);
        yield* awaited(delivered());
      }),
    );
  yield* awaited(delivered());
  expect(reports).toEqual([failure]);
  yield* awaited(harness.close(context));
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_closed" });
});

describe("listener and report errors", () => {
  it("keeps feeding the other observers of a view when one throws", () =>
    Effect.runPromise(keepsFeedingOther));
});
