import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { awaited, runTest, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { withFileMutationQueue } from "../src/core/tools/file-mutation-queue.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tempDirs: string[] = [];

function createTempDir(): Promise<string> {
  return runTest(
    Effect.gen(function* () {
      const dir = yield* awaited(mkdtemp(joinPath(tmpdir(), "msa-file-mutation-queue-")));
      tempDirs.push(dir);
      return yield* awaited(dir);
    }),
  );
}

afterEach(() =>
  runTest(
    awaited(
      Promise.all(
        tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
      ),
    ),
  ),
);

describe("withFileMutationQueue", () => {
  it("serializes operations for the same file", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const order: string[] = [];
        const path = "/tmp/file-mutation-queue-same";

        const first = withFileMutationQueue(path, () =>
          effectRunPromise(
            Effect.gen(function* () {
              order.push("first:start");
              yield* awaited(delay(30));
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
    ));

  it("allows different files to proceed in parallel", () =>
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
                  yield* awaited(delay(30));
                  order.push("a:end");
                }),
              ),
            ),
            withFileMutationQueue("/tmp/file-mutation-queue-b", () =>
              effectRunPromise(
                Effect.gen(function* () {
                  order.push("b:start");
                  yield* awaited(delay(30));
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
    ));

  it("uses the same queue for symlink aliases", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const dir = yield* awaited(createTempDir());
        const targetPath = joinPath(dir, "target.txt");
        const symlinkPath = joinPath(dir, "alias.txt");
        yield* awaited(writeFile(targetPath, "hello\n", "utf8"));
        yield* awaited(symlink(targetPath, symlinkPath));

        const order: string[] = [];
        yield* awaited(
          Promise.all([
            withFileMutationQueue(targetPath, () =>
              effectRunPromise(
                Effect.gen(function* () {
                  order.push("target:start");
                  yield* awaited(delay(30));
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
    ));
});
