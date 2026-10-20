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

const serializesOperationsForTheSameFile = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const order: string[] = [];
      const path = "/tmp/file-mutation-queue-same";

      const first = withFileMutationQueue(path, () =>
        effectRunPromise(
          Effect.gen(function* () {
            order.push("first:start");
            yield* sleep(30);
            order.push("first:end");
          }),
        ),
      );
      const second = withFileMutationQueue(path, () =>
        effectRunPromise(
          Effect.sync(() => {
            order.push("second:start");
            order.push("second:end");
          }),
        ),
      );

      yield* awaited(Promise.all([first, second]));
      expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    }),
  );

const allowsDifferentFilesToProceedInParallel = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const order: string[] = [];

      yield* awaited(
        Promise.all([
          withFileMutationQueue("/tmp/file-mutation-queue-a", () =>
            effectRunPromise(
              Effect.gen(function* () {
                order.push("a:start");
                yield* sleep(30);
                order.push("a:end");
              }),
            ),
          ),
          withFileMutationQueue("/tmp/file-mutation-queue-b", () =>
            effectRunPromise(
              Effect.gen(function* () {
                order.push("b:start");
                yield* sleep(30);
                order.push("b:end");
              }),
            ),
          ),
        ]),
      );

      expect(order.indexOf("a:start")).toBeLessThan(order.indexOf("a:end"));
      expect(order.indexOf("b:start")).toBeLessThan(order.indexOf("b:end"));
      expect(order.indexOf("b:start")).toBeLessThan(order.indexOf("a:end"));
    }),
  );

const usesTheSameQueueForSymlinkAliases = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const dir = yield* createTempDir();
      const targetPath = joinPath(dir, "target.txt");
      const symlinkPath = joinPath(dir, "alias.txt");
      yield* writeTextFile(targetPath, "hello\n");
      yield* makeSymlink(targetPath, symlinkPath);

      const order: string[] = [];
      yield* awaited(
        Promise.all([
          withFileMutationQueue(targetPath, () =>
            effectRunPromise(
              Effect.gen(function* () {
                order.push("target:start");
                yield* sleep(30);
                order.push("target:end");
              }),
            ),
          ),
          withFileMutationQueue(symlinkPath, () =>
            effectRunPromise(
              Effect.sync(() => {
                order.push("alias:start");
                order.push("alias:end");
              }),
            ),
          ),
        ]),
      );

      expect(order).toEqual(["target:start", "target:end", "alias:start", "alias:end"]);
    }),
  );

describe("withFileMutationQueue", () => {
  it("serializes operations for the same file", serializesOperationsForTheSameFile);

  it("allows different files to proceed in parallel", allowsDifferentFilesToProceedInParallel);

  it("uses the same queue for symlink aliases", usesTheSameQueueForSymlinkAliases);
});
