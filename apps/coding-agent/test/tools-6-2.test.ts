import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { createGrepToolDefinition } from "../src/core/tools/grep.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import tools6Support from "./tools-6-support.ts";

const { getTextOutput } = tools6Support;

const { awaited, joinPath, makeTempDir, readTextFile, removePath, runTest, writeTextFile } =
  testing;

function fakeCtx(cwd: string): ExtensionToolContext {
  return { cwd } as ExtensionToolContext;
}

let testDir = "";

beforeEach(() =>
  runTest(makeTempDir("coding-agent-tools-")).then((dir) => {
    testDir = dir;
    return dir;
  }),
);

afterEach(() => {
  vi.restoreAllMocks();
  return runTest(removePath(testDir));
});

const readUsesCtxCwdWhenProvided = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "ctx-cwd-read.txt");
      yield* writeTextFile(testFile, "hello from ctx.cwd");
      const tool = createReadToolDefinition("/");
      const result = yield* awaited(
        tool.execute(
          "test-read-ctx-cwd",
          { path: "ctx-cwd-read.txt" },
          undefined,
          undefined,
          fakeCtx(testDir),
        ),
      );
      const output = getTextOutput(result);
      expect(output).toContain("hello from ctx.cwd");
    }),
  );

const writeUsesCtxCwdWhenProvided = () =>
  runTest(
    Effect.gen(function* () {
      const tool = createWriteToolDefinition("/");
      yield* awaited(
        tool.execute(
          "test-write-ctx-cwd",
          { content: "written via ctx.cwd", path: "ctx-cwd-write.txt" },
          undefined,
          undefined,
          fakeCtx(testDir),
        ),
      );
      const content = yield* readTextFile(joinPath(testDir, "ctx-cwd-write.txt"));
      expect(content).toBe("written via ctx.cwd");
    }),
  );

const editUsesCtxCwdWhenProvided = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "ctx-cwd-edit.txt");
      yield* writeTextFile(testFile, "old text");
      const tool = createEditToolDefinition("/");
      yield* awaited(
        tool.execute(
          "test-edit-ctx-cwd",
          { edits: [{ newText: "new text", oldText: "old text" }], path: "ctx-cwd-edit.txt" },
          undefined,
          undefined,
          fakeCtx(testDir),
        ),
      );
      const content = yield* readTextFile(testFile);
      expect(content).toBe("new text");
    }),
  );

const grepUsesCtxCwdWhenProvided = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "ctx-cwd-grep.txt");
      yield* writeTextFile(testFile, "match in ctx.cwd");
      const tool = createGrepToolDefinition("/");
      const result = yield* awaited(
        tool.execute(
          "test-grep-ctx-cwd",
          { pattern: "match" },
          undefined,
          undefined,
          fakeCtx(testDir),
        ),
      );
      const output = getTextOutput(result);
      expect(output).toContain("ctx-cwd-grep.txt");
    }),
  );

describe("tool cwd resolution", () => {
  it("read uses ctx.cwd when provided", readUsesCtxCwdWhenProvided);

  it("write uses ctx.cwd when provided", writeUsesCtxCwdWhenProvided);

  it("edit uses ctx.cwd when provided", editUsesCtxCwdWhenProvided);

  it("grep uses ctx.cwd when provided", grepUsesCtxCwdWhenProvided);
});
