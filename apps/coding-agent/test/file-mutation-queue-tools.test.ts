import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import edit from "../src/core/tools/edit.ts";
import write from "../src/core/tools/write.ts";
import fileMutationQueueToolsSupport from "./file-mutation-queue-tools-support.ts";

const { createEditTool } = edit;
const { createWriteTool } = write;

const { accessFile, createDeferred, delay } = fileMutationQueueToolsSupport;

const {
  abortController,
  awaited,
  joinPath,
  makeTempDir,
  readBytesFile,
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

const preservesBothParallelEditsOnTheSame = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const dir = yield* awaited(createTempDir());
  const filePath = joinPath(dir, "parallel-edit.txt");
  yield* writeTextFile(filePath, "alpha\nbeta\ngamma\n");

  const editTool = createEditTool(dir, {
    operations: {
      access: accessFile,
      readFile: (path) =>
        effectRunPromise(
          Effect.gen(function* () {
            const buffer = Buffer.from(yield* readBytesFile(path));
            yield* awaited(delay(30));
            return yield* awaited(buffer);
          }),
        ),
      writeFile: (path, content) =>
        effectRunPromise(
          Effect.gen(function* () {
            yield* awaited(delay(30));
            yield* writeTextFile(path, content);
          }),
        ),
    },
  });

  yield* awaited(
    Promise.all([
      editTool.execute("call-1", {
        edits: [{ newText: "ALPHA", oldText: "alpha" }],
        path: filePath,
      }),
      editTool.execute("call-2", {
        edits: [{ newText: "BETA", oldText: "beta" }],
        path: filePath,
      }),
    ]),
  );

  const content = yield* readTextFile(filePath);
  expect(content).toBe("ALPHA\nBETA\ngamma\n");
});

const sharesTheQueueBetweenEditAndWritePart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const dir = yield* awaited(createTempDir());
    const filePath = joinPath(dir, "mixed.txt");
    yield* writeTextFile(filePath, "original\n");

    const editTool = createEditTool(dir, {
      operations: {
        access: accessFile,
        readFile: (path) =>
          effectRunPromise(
            Effect.gen(function* () {
              const buffer = Buffer.from(yield* readBytesFile(path));
              yield* awaited(delay(30));
              return yield* awaited(buffer);
            }),
          ),
        writeFile: (path, content) =>
          effectRunPromise(
            Effect.gen(function* () {
              yield* awaited(delay(30));
              yield* writeTextFile(path, content);
            }),
          ),
      },
    });
    return { dir, editTool, effectRunPromise, filePath };
  });

const sharesTheQueueBetweenEditAndWrite = Effect.gen(function* () {
  const { dir, editTool, effectRunPromise, filePath } =
    yield* sharesTheQueueBetweenEditAndWritePart1();
  const writeTool = createWriteTool(dir, {
    operations: {
      mkdir: () => effectRunPromise(Effect.sync(() => {})),
      writeFile: (path, content) =>
        effectRunPromise(
          Effect.gen(function* () {
            yield* awaited(delay(10));
            yield* writeTextFile(path, content);
          }),
        ),
    },
  });

  const editPromise = editTool.execute("call-1", {
    edits: [{ newText: "edited", oldText: "original" }],
    path: filePath,
  });
  yield* awaited(delay(5));
  const writePromise = writeTool.execute("call-2", {
    content: "replacement\n",
    path: filePath,
  });

  yield* awaited(Promise.all([editPromise, writePromise]));

  const content = yield* readTextFile(filePath);
  expect(content).toBe("replacement\n");
});

const partStep1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const dir = yield* awaited(createTempDir());
    const filePath = joinPath(dir, "abort-write.txt");
    const firstWriteStarted = createDeferred();
    const finishFirstWrite = createDeferred();
    return { dir, effectRunPromise, filePath, finishFirstWrite, firstWriteStarted };
  });

describe("built-in edit and write tools", () => {
  it("preserves both parallel edits on the same file", () =>
    runTest(preservesBothParallelEditsOnTheSame));

  it("shares the queue between edit and write", () => runTest(sharesTheQueueBetweenEditAndWrite));
});

const keepsWriteQueueLockedWhileAnAborted = Effect.gen(function* () {
  const { dir, effectRunPromise, filePath, finishFirstWrite, firstWriteStarted } =
    yield* partStep1();
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
              yield* writeTextFile(path, content);
              firstWriteSettled = true;
              return;
            }

            if (content === "second\n") {
              expect(firstWriteSettled).toBe(true);
              secondWriteStarted.resolve();
            }
            yield* writeTextFile(path, content);
          }),
        ),
    },
  });

  const controller = abortController();
  const firstWrite = writeTool.execute(
    "call-1",
    { content: "first\n", path: filePath },
    controller.signal,
  );
  yield* awaited(firstWriteStarted.promise);
  controller.abort();

  const secondWrite = writeTool.execute("call-2", { content: "second\n", path: filePath });
  expect(yield* awaited(resolvesWithin(secondWriteStarted.promise, 20))).toBe(false);

  finishFirstWrite.resolve();
  yield* awaited(expect(firstWrite).rejects.toThrow("Operation aborted"));
  yield* awaited(secondWrite);

  const content = yield* readTextFile(filePath);
  expect(content).toBe("second\n");
});

describe("built-in edit and write tools", () => {
  it("keeps write queue locked while an aborted write is still in flight", () =>
    runTest(keepsWriteQueueLockedWhileAnAborted));
});
