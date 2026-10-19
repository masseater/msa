import { BACKGROUND_CONTEXT, withAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { withFileMutationQueue } from "../src/tools/env.ts";
import { createEditTool, createWriteTool } from "../src/tools/index.ts";
import { abortController, awaited, makeDirectory, makeSymlink } from "./support.ts";
import { BlockingEditExecutionEnv } from "./tools-blocking-edit-env-support.ts";
import { SlowReadExecutionEnv } from "./tools-slow-read-env-support.ts";
import {
  BlockingWriteExecutionEnv,
  createEnv,
  createTempDir,
  deferred,
  delay,
  removeTempDirs,
  run,
} from "./tools-support.ts";

afterAll(() => Effect.runPromise(removeTempDirs));

const matchesAllEdits = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(yield* awaited(env.writeFile("edit.txt", "one\ntwo\nthree\n", BACKGROUND_CONTEXT)));
  yield* awaited(
    expect(
      run(
        createEditTool(),
        {
          path: "edit.txt",
          edits: [
            { oldText: "one\ntwo\n", newText: "ONE\nTWO\n" },
            { oldText: "two\nthree\n", newText: "TWO\nTHREE\n" },
          ],
        },
        env,
      ),
    ).rejects.toThrow(/overlap/u),
  );
  expect(getOrThrow(yield* awaited(env.readTextFile("edit.txt", BACKGROUND_CONTEXT)))).toBe(
    "one\ntwo\nthree\n",
  );
});

const rejectsMissingDuplicate = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(yield* awaited(env.writeFile("edit.txt", "foo foo foo", BACKGROUND_CONTEXT)));
  const tool = createEditTool();
  yield* awaited(
    expect(
      run(tool, { path: "edit.txt", edits: [{ oldText: "bar", newText: "baz" }] }, env),
    ).rejects.toThrow(/Could not find the exact text/u),
  );
  yield* awaited(
    expect(
      run(tool, { path: "edit.txt", edits: [{ oldText: "foo", newText: "bar" }] }, env),
    ).rejects.toThrow(/Found 3 occurrences/u),
  );
});

describe("durable tools", () => {
  describe("edit", () => {
    it("matches all edits against the original and rejects overlaps", () =>
      Effect.runPromise(matchesAllEdits));

    it("rejects missing and duplicate target text", () =>
      Effect.runPromise(rejectsMissingDuplicate));
  });
});

const keepsMutationQueue = Effect.gen(function* () {
  const env = new BlockingEditExecutionEnv({ cwd: yield* createTempDir });
  getOrThrow(yield* awaited(env.writeFile("file.txt", "alpha\nbeta\n", BACKGROUND_CONTEXT)));
  const tool = createEditTool();
  const controller = abortController();
  const firstEdit = run(
    tool,
    { path: "file.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] },
    env,
    withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
  );
  yield* awaited(env.firstEditWriteStarted.promise);
  controller.abort();
  const secondEdit = run(
    tool,
    { path: "file.txt", edits: [{ oldText: "beta", newText: "BETA" }] },
    env,
  );
  yield* awaited(delay(20));
  expect(env.secondEditWriteStarted).toBe(false);
  env.finishFirstEditWrite.resolve();
  yield* awaited(expect(firstEdit).rejects.toThrow("Operation aborted"));
  yield* awaited(secondEdit);
  expect(env.firstEditWriteSettled).toBe(true);
  expect(getOrThrow(yield* awaited(env.readTextFile("file.txt", BACKGROUND_CONTEXT)))).toBe(
    "ALPHA\nBETA\n",
  );
});

const serializesConcurrentEdits = Effect.gen(function* () {
  const env = new SlowReadExecutionEnv({ cwd: yield* createTempDir });
  getOrThrow(
    yield* awaited(env.writeFile("target.txt", "alpha\nbeta\ngamma\n", BACKGROUND_CONTEXT)),
  );
  yield* makeSymlink("target.txt", `${env.cwd}/link.txt`);
  const tool = createEditTool();
  yield* awaited(
    Promise.all([
      run(tool, { path: "target.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, env),
      run(tool, { path: "link.txt", edits: [{ oldText: "beta", newText: "BETA" }] }, env),
    ]),
  );
  expect(getOrThrow(yield* awaited(env.readTextFile("target.txt", BACKGROUND_CONTEXT)))).toBe(
    "ALPHA\nBETA\ngamma\n",
  );
});

describe("durable tools", () => {
  describe("edit", () => {
    it("keeps the mutation queue locked until an aborted edit write settles", () =>
      Effect.runPromise(keepsMutationQueue));

    it("serializes concurrent edits through canonical and symlink paths", () =>
      Effect.runPromise(serializesConcurrentEdits));
  });
});

const serializesEditsOne = Effect.gen(function* () {
  const dir = yield* createTempDir;
  const first = new SlowReadExecutionEnv({ cwd: dir });
  const second = new SlowReadExecutionEnv({ cwd: dir });
  getOrThrow(yield* awaited(first.writeFile("file.txt", "alpha\nbeta\n", BACKGROUND_CONTEXT)));
  const tool = createEditTool();
  yield* awaited(
    Promise.all([
      run(tool, { path: "file.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, first),
      run(tool, { path: "file.txt", edits: [{ oldText: "beta", newText: "BETA" }] }, second),
    ]),
  );
  expect(getOrThrow(yield* awaited(first.readTextFile("file.txt", BACKGROUND_CONTEXT)))).toBe(
    "ALPHA\nBETA\n",
  );
});

const serializesNewFile = Effect.gen(function* () {
  const env = new BlockingWriteExecutionEnv({ cwd: yield* createTempDir });
  yield* makeDirectory(`${env.cwd}/real`);
  yield* makeSymlink(`${env.cwd}/real`, `${env.cwd}/link`);
  const tool = createWriteTool();
  const first = run(tool, { path: "link/new.txt", content: "first\n" }, env);
  yield* awaited(env.firstWriteStarted.promise);
  const second = run(tool, { path: "real/new.txt", content: "second\n" }, env);
  yield* awaited(delay(20));
  expect(env.secondWriteStarted).toBe(false);
  env.finishFirstWrite.resolve();
  yield* awaited(Promise.all([first, second]));
  expect(getOrThrow(yield* awaited(env.readTextFile("real/new.txt", BACKGROUND_CONTEXT)))).toBe(
    "second\n",
  );
});

describe("durable tools", () => {
  describe("edit", () => {
    it("serializes edits of one file across environment objects of one file system", () =>
      Effect.runPromise(serializesEditsOne));

    it("serializes a new file created through a symlinked directory with its canonical path", () =>
      Effect.runPromise(serializesNewFile));
  });
});

describe("durable tools", () => {
  describe("edit", () => {
    it.skipIf(process.platform === "win32")(
      "keys a missing file whose name contains a backslash like the created file",
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            const env = yield* createEnv;
            const created = deferred();
            const release = deferred();
            const first = withFileMutationQueue(
              env,
              "a\\b.txt",
              () =>
                runPromise(
                  Effect.gen(function* () {
                    getOrThrow(
                      yield* awaited(env.writeFile("a\\b.txt", "first\n", BACKGROUND_CONTEXT)),
                    );
                    created.resolve();
                    yield* awaited(release.promise);
                  }),
                ),
              BACKGROUND_CONTEXT,
            );
            yield* awaited(created.promise);
            let entered = false;
            const second = withFileMutationQueue(
              env,
              "a\\b.txt",
              () => {
                entered = true;

                return Promise.resolve();
              },
              BACKGROUND_CONTEXT,
            );
            yield* awaited(delay(20));
            expect(entered).toBe(false);
            release.resolve();
            yield* awaited(Promise.all([first, second]));
            expect(entered).toBe(true);
          }),
        ),
    );
  });
});
