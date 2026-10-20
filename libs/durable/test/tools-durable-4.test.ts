import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { createEditTool, createWriteTool } from "../src/tools/index.ts";
import support from "./support.ts";
import toolsSupport from "./tools-support.ts";

const { awaited, makeSymlink } = support;
const { BlockingWriteExecutionEnv, createEnv, createTempDir, removeTempDirs, run } = toolsSupport;

afterAll(() => Effect.runPromise(removeTempDirs));

const doesNotSerialize = Effect.gen(function* () {
  class OtherFileSystem extends BlockingWriteExecutionEnv {
    override readonly id = "other";
  }
  const dir = yield* createTempDir;
  const local = new BlockingWriteExecutionEnv({ cwd: dir });
  const other = new OtherFileSystem({ cwd: dir });
  const tool = createWriteTool();
  const blocked = run(tool, { content: "first\n", path: "file.txt" }, local);
  yield* awaited(local.firstWriteStarted.promise);
  yield* awaited(run(tool, { content: "second\n", path: "file.txt" }, other));
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
      { edits: [{ newText: "after", oldText: "before" }], path: "link.txt" },
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
    run(createEditTool(), { edits: [{ newText: "TWO", oldText: "two" }], path: "edit.txt" }, env),
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
