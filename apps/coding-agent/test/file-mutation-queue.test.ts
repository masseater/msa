import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import fileMutationQueue from "../src/core/tools/file-mutation-queue.ts";

const { withFileMutationQueue } = fileMutationQueue;

const { awaited, joinPath, makeSymlink, makeTempDir, removeDirs, runTest, sleep, writeTextFile } =
  testing;

const tempDirs: string[] = [];

const createTempDir = Effect.fn("createTempDir")(function* () {
  const dir = yield* makeTempDir("msa-file-mutation-queue-");
  tempDirs.push(dir);
  return dir;
});

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

interface QueuedOperation {
  readonly delayMs: number;
  readonly label: string;
  readonly path: string;
}

const runQueued = (operations: readonly QueuedOperation[]) =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const order: string[] = [];
    yield* Effect.forEach(
      operations.map(({ delayMs, label, path }) =>
        withFileMutationQueue(path, () =>
          effectRunPromise(
            Effect.gen(function* () {
              order.push(`${label}:start`);
              if (delayMs > 0) {
                yield* sleep(delayMs);
              }
              order.push(`${label}:end`);
            }),
          ),
        ),
      ),
      awaited,
      { concurrency: "unbounded" },
    );
    return order;
  });

const serializesOperationsForTheSameFile = () =>
  runTest(
    Effect.gen(function* () {
      const path = "/tmp/file-mutation-queue-same";
      const order = yield* runQueued([
        { delayMs: 30, label: "first", path },
        { delayMs: 0, label: "second", path },
      ]);
      expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    }),
  );

const allowsDifferentFilesToProceedInParallel = () =>
  runTest(
    Effect.gen(function* () {
      const order = yield* runQueued([
        { delayMs: 30, label: "a", path: "/tmp/file-mutation-queue-a" },
        { delayMs: 30, label: "b", path: "/tmp/file-mutation-queue-b" },
      ]);

      expect(order.indexOf("a:start")).toBeLessThan(order.indexOf("a:end"));
      expect(order.indexOf("b:start")).toBeLessThan(order.indexOf("b:end"));
      expect(order.indexOf("b:start")).toBeLessThan(order.indexOf("a:end"));
    }),
  );

const usesTheSameQueueForSymlinkAliases = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* createTempDir();
      const targetPath = joinPath(dir, "target.txt");
      const symlinkPath = joinPath(dir, "alias.txt");
      yield* writeTextFile(targetPath, "hello\n");
      yield* makeSymlink(targetPath, symlinkPath);

      const order = yield* runQueued([
        { delayMs: 30, label: "target", path: targetPath },
        { delayMs: 0, label: "alias", path: symlinkPath },
      ]);

      expect(order).toEqual(["target:start", "target:end", "alias:start", "alias:end"]);
    }),
  );

describe("withFileMutationQueue", () => {
  it("serializes operations for the same file", serializesOperationsForTheSameFile);

  it("allows different files to proceed in parallel", allowsDifferentFilesToProceedInParallel);

  it("uses the same queue for symlink aliases", usesTheSameQueueForSymlinkAliases);
});
