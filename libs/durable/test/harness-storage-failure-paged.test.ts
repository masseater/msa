import type { Context } from "@msa/chord";
import type memoryTypes from "@msa/durable/storage/memory.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessStorageFailureSupport from "./harness-storage-failure-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { started } = harnessStorageFailureSupport;
const { ControlledStorage, context } = sessionSupport;
const { deferred } = taskSupport;

const closesBackendOnly = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const pages: string[] = [];
  const firstPage = deferred();
  const releaseFirst = deferred();
  class Paged extends ControlledStorage {
    override scanEntries(...args: Parameters<memoryTypes.MemoryStorage["scanEntries"]>) {
      const superScanEntries = super.scanEntries.bind(this);
      return runPromise(
        Effect.gen(function* () {
          if (args[1] > 1) {
            pages.push(args[2] === undefined ? "first" : "next");
            if (args[2] === undefined) {
              firstPage.resolve();
              yield* awaited(releaseFirst.promise);
            }
          }
          return yield* awaited(superScanEntries(...args));
        }),
      );
    }
    override close(closeContext: Context): Promise<void> {
      pages.push("close");
      return Promise.resolve(super.close(closeContext));
    }
  }
  const storage = new Paged();
  const { harness, root } = yield* started(storage);
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            for (const _ of Array.from({ length: 300 }))
              yield* awaited(tx.appendEntry(root.id, { kind: "note" }));
          }),
        ),
      context,
    ),
  );
  const reading = root.context(context);
  yield* awaited(firstPage.promise);
  const closing = harness.close(context);
  releaseFirst.resolve();
  yield* awaited(expect(reading).rejects.toThrow("is closed"));
  yield* awaited(closing);
  expect(pages).toEqual(["first", "close"]);
  expect(yield* awaited(harness.closed)).toEqual({ reason: "closed" });
});

describe("a failed Storage call", () => {
  it("closes the backend only after a paged read underway, which cannot start another page", () =>
    Effect.runPromise(closesBackendOnly));
});
