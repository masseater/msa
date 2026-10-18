import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { awaited, runTest, abortController, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createEditTool } from "../src/core/tools/edit.ts";
import { withFileMutationQueue } from "../src/core/tools/file-mutation-queue.ts";
import { createWriteTool } from "../src/core/tools/write.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function resolvesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return runTest(awaited(Promise.race([promise.then(() => true), delay(ms).then(() => false)])));
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

describe("built-in edit and write tools", () => {
  it("preserves both parallel edits on the same file", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const dir = yield* awaited(createTempDir());
        const filePath = joinPath(dir, "parallel-edit.txt");
        yield* awaited(writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8"));

        const editTool = createEditTool(dir, {
          operations: {
            access,
            readFile: (path) =>
              effectRunPromise(
                Effect.gen(function* () {
                  const buffer = yield* awaited(readFile(path));
                  yield* awaited(delay(30));
                  return yield* awaited(buffer);
                }),
              ),
            writeFile: (path, content) =>
              effectRunPromise(
                Effect.gen(function* () {
                  yield* awaited(delay(30));
                  yield* awaited(writeFile(path, content, "utf8"));
                }),
              ),
          },
        });

        yield* awaited(
          Promise.all([
            editTool.execute("call-1", {
              path: filePath,
              edits: [{ oldText: "alpha", newText: "ALPHA" }],
            }),
            editTool.execute("call-2", {
              path: filePath,
              edits: [{ oldText: "beta", newText: "BETA" }],
            }),
          ]),
        );

        const content = yield* awaited(readFile(filePath, "utf8"));
        expect(content).toBe("ALPHA\nBETA\ngamma\n");
      }),
    ));

  it("shares the queue between edit and write", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const dir = yield* awaited(createTempDir());
        const filePath = joinPath(dir, "mixed.txt");
        yield* awaited(writeFile(filePath, "original\n", "utf8"));

        const editTool = createEditTool(dir, {
          operations: {
            access,
            readFile: (path) =>
              effectRunPromise(
                Effect.gen(function* () {
                  const buffer = yield* awaited(readFile(path));
                  yield* awaited(delay(30));
                  return yield* awaited(buffer);
                }),
              ),
            writeFile: (path, content) =>
              effectRunPromise(
                Effect.gen(function* () {
                  yield* awaited(delay(30));
                  yield* awaited(writeFile(path, content, "utf8"));
                }),
              ),
          },
        });
        const writeTool = createWriteTool(dir, {
          operations: {
            mkdir: () => effectRunPromise(Effect.sync(() => {})),
            writeFile: (path, content) =>
              effectRunPromise(
                Effect.gen(function* () {
                  yield* awaited(delay(10));
                  yield* awaited(writeFile(path, content, "utf8"));
                }),
              ),
          },
        });

        const editPromise = editTool.execute("call-1", {
          path: filePath,
          edits: [{ oldText: "original", newText: "edited" }],
        });
        yield* awaited(delay(5));
        const writePromise = writeTool.execute("call-2", {
          path: filePath,
          content: "replacement\n",
        });

        yield* awaited(Promise.all([editPromise, writePromise]));

        const content = yield* awaited(readFile(filePath, "utf8"));
        expect(content).toBe("replacement\n");
      }),
    ));

  it("keeps write queue locked while an aborted write is still in flight", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const dir = yield* awaited(createTempDir());
        const filePath = joinPath(dir, "abort-write.txt");
        const firstWriteStarted = createDeferred();
        const finishFirstWrite = createDeferred();
        const secondWriteStarted = createDeferred();
        let firstWriteSettled = false;

        const writeTool = createWriteTool(dir, {
          operations: {
            mkdir: () => effectRunPromise(Effect.sync(() => {})),
            writeFile: (path, content) =>
              effectRunPromise(
                Effect.gen(function* () {
                  if (content === "first\n") {
                    firstWriteStarted.resolve();
                    yield* awaited(finishFirstWrite.promise);
                    yield* awaited(writeFile(path, content, "utf8"));
                    firstWriteSettled = true;
                    return;
                  }

                  if (content === "second\n") {
                    expect(firstWriteSettled).toBe(true);
                    secondWriteStarted.resolve();
                  }
                  yield* awaited(writeFile(path, content, "utf8"));
                }),
              ),
          },
        });

        const controller = abortController();
        const firstWrite = writeTool.execute(
          "call-1",
          { path: filePath, content: "first\n" },
          controller.signal,
        );
        yield* awaited(firstWriteStarted.promise);
        controller.abort();

        const secondWrite = writeTool.execute("call-2", { path: filePath, content: "second\n" });
        expect(yield* awaited(resolvesWithin(secondWriteStarted.promise, 20))).toBe(false);

        finishFirstWrite.resolve();
        yield* awaited(expect(firstWrite).rejects.toThrow("Operation aborted"));
        yield* awaited(secondWrite);

        const content = yield* awaited(readFile(filePath, "utf8"));
        expect(content).toBe("second\n");
      }),
    ));

  it("keeps edit queue locked while an aborted edit write is still in flight", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const dir = yield* awaited(createTempDir());
        const filePath = joinPath(dir, "abort-edit.txt");
        yield* awaited(writeFile(filePath, "alpha\nbeta\n", "utf8"));
        const firstWriteStarted = createDeferred();
        const finishFirstWrite = createDeferred();
        const secondWriteStarted = createDeferred();
        let firstWriteSettled = false;

        const editTool = createEditTool(dir, {
          operations: {
            access,
            readFile,
            writeFile: (path, content) =>
              effectRunPromise(
                Effect.gen(function* () {
                  if (content === "ALPHA\nbeta\n") {
                    firstWriteStarted.resolve();
                    yield* awaited(finishFirstWrite.promise);
                    yield* awaited(writeFile(path, content, "utf8"));
                    firstWriteSettled = true;
                    return;
                  }

                  if (content === "ALPHA\nBETA\n" || content === "alpha\nBETA\n") {
                    expect(firstWriteSettled).toBe(true);
                    secondWriteStarted.resolve();
                  }
                  yield* awaited(writeFile(path, content, "utf8"));
                }),
              ),
          },
        });

        const controller = abortController();
        const firstEdit = editTool.execute(
          "call-1",
          { path: filePath, edits: [{ oldText: "alpha", newText: "ALPHA" }] },
          controller.signal,
        );
        yield* awaited(firstWriteStarted.promise);
        controller.abort();

        const secondEdit = editTool.execute("call-2", {
          path: filePath,
          edits: [{ oldText: "beta", newText: "BETA" }],
        });
        expect(yield* awaited(resolvesWithin(secondWriteStarted.promise, 20))).toBe(false);

        finishFirstWrite.resolve();
        yield* awaited(expect(firstEdit).rejects.toThrow("Operation aborted"));
        yield* awaited(secondEdit);

        const content = yield* awaited(readFile(filePath, "utf8"));
        expect(content).toBe("ALPHA\nBETA\n");
      }),
    ));
});
