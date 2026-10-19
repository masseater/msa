import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { createEditTool, createWriteTool } from "../src/tools/index.ts";
import { awaited, makeSymlink } from "./support.ts";
import {
  BlockingWriteExecutionEnv,
  createEnv,
  createTempDir,
  removeTempDirs,
  run,
} from "./tools-support.ts";

afterAll(() => Effect.runPromise(removeTempDirs));

const doesNotSerialize = Effect.gen(function* () {
  class OtherFileSystem extends BlockingWriteExecutionEnv {
    override readonly id = "other";
  }
  const dir = yield* createTempDir;
  const local = new BlockingWriteExecutionEnv({ cwd: dir });
  const other = new OtherFileSystem({ cwd: dir });
  const tool = createWriteTool();
  const blocked = run(tool, { path: "file.txt", content: "first\n" }, local);
  yield* awaited(local.firstWriteStarted.promise);
  yield* awaited(run(tool, { path: "file.txt", content: "second\n" }, other));
  expect(other.secondWriteStarted).toBe(true);
  local.finishFirstWrite.resolve();
  yield* awaited(blocked);
});

const editsRegularFiles = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(yield* awaited(env.writeFile("target.txt", "before\n", BACKGROUND_CONTEXT)));
  yield* makeSymlink("target.txt", `${env.cwd}/link.txt`);
  yield* awaited(
    run(
      createEditTool(),
      { path: "link.txt", edits: [{ oldText: "before", newText: "after" }] },
      env,
    ),
  );
  expect(getOrThrow(yield* awaited(env.readTextFile("target.txt", BACKGROUND_CONTEXT)))).toBe(
    "after\n",
  );
});

const preservesBomCrlf = Effect.gen(function* () {
  const env = yield* createEnv;
  getOrThrow(yield* awaited(env.writeFile("edit.txt", "\uFEFFone\r\ntwo\r\n", BACKGROUND_CONTEXT)));
  yield* awaited(
    run(createEditTool(), { path: "edit.txt", edits: [{ oldText: "two", newText: "TWO" }] }, env),
  );
  expect(getOrThrow(yield* awaited(env.readTextFile("edit.txt", BACKGROUND_CONTEXT)))).toBe(
    "\uFEFFone\r\nTWO\r\n",
  );
});

describe("durable tools", () => {
  describe("edit", () => {
    it("does not serialize the same path on different file systems", () =>
      Effect.runPromise(doesNotSerialize));

    it("edits regular files through symlinks", () => Effect.runPromise(editsRegularFiles));

    it("preserves BOM and CRLF line endings", () => Effect.runPromise(preservesBomCrlf));
  });
});
