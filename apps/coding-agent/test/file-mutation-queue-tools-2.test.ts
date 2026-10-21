import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import edit from "../src/core/tools/edit.ts";
import fileMutationQueueToolsSupport from "./file-mutation-queue-tools-support.ts";

const { createEditTool } = edit;

const { accessFile, createDeferred, delay, readFileBuffer } = fileMutationQueueToolsSupport;

const {
  abortController,
  awaited,
  joinPath,
  makeTempDir,
  readTextFile,
  removeDirs,
  runTest,
  writeTextFile,
} = testing;

function resolvesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return runTest(awaited(Promise.race([promise.then(() => true), delay(ms).then(() => false)])));
}

const tempDirs: string[] = [];

function createTempDir(): Promise<string> {
  return runTest(
    Effect.gen(function* () {
      const dir = yield* makeTempDir("msa-file-mutation-queue-");
      tempDirs.push(dir);
      return yield* awaited(dir);
    }),
  );
}

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const setUpBlockingEditTool = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const dir = yield* awaited(createTempDir());
    const filePath = joinPath(dir, "abort-edit.txt");
    yield* writeTextFile(filePath, "alpha\nbeta\n");
    const firstWriteStarted = createDeferred();
    const finishFirstWrite = createDeferred();
    const secondWriteStarted = createDeferred();
    let firstWriteSettled = false;

    const editTool = createEditTool(dir, {
      operations: {
        access: accessFile,
        readFile: readFileBuffer,
        writeFile: (path, content) =>
          effectRunPromise(
            Effect.gen(function* () {
              if (content === "ALPHA\nbeta\n") {
                firstWriteStarted.resolve();
                yield* awaited(finishFirstWrite.promise);
                yield* writeTextFile(path, content);
                firstWriteSettled = true;
                return;
              }

              if (content === "ALPHA\nBETA\n" || content === "alpha\nBETA\n") {
                expect(firstWriteSettled).toBe(true);
                secondWriteStarted.resolve();
              }
              yield* writeTextFile(path, content);
            }),
          ),
      },
    });
    return { editTool, filePath, finishFirstWrite, firstWriteStarted, secondWriteStarted };
  });

const keepsEditQueueLockedWhileAnAborted = () =>
  runTest(
    Effect.gen(function* () {
      const { editTool, filePath, finishFirstWrite, firstWriteStarted, secondWriteStarted } =
        yield* setUpBlockingEditTool();

      const controller = abortController();
      const firstEdit = editTool.execute(
        "call-1",
        { edits: [{ newText: "ALPHA", oldText: "alpha" }], path: filePath },
        controller.signal,
      );
      yield* awaited(firstWriteStarted.promise);
      controller.abort();

      const secondEdit = editTool.execute("call-2", {
        edits: [{ newText: "BETA", oldText: "beta" }],
        path: filePath,
      });
      expect(yield* awaited(resolvesWithin(secondWriteStarted.promise, 20))).toBe(false);

      finishFirstWrite.resolve();
      yield* awaited(expect(firstEdit).rejects.toThrow("Operation aborted"));
      yield* awaited(secondEdit);

      const content = yield* readTextFile(filePath);
      expect(content).toBe("ALPHA\nBETA\n");
    }),
  );

describe("built-in edit and write tools", () => {
  it(
    "keeps edit queue locked while an aborted edit write is still in flight",
    keepsEditQueueLockedWhileAnAborted,
  );
});
