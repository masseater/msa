import {
  awaited,
  runTest,
  readTextFile,
  writeTextFile,
  pathExists,
  makeDirectory,
  changeMode,
  joinPath,
  makeTempDir,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { createGrepToolDefinition } from "../src/core/tools/grep.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { createFindTool, createGrepTool, createLsTool } from "../src/index.ts";

const grepTool = createGrepTool(process.cwd());
const findTool = createFindTool(process.cwd());
const lsTool = createLsTool(process.cwd());

function getTextOutput(result: any): string {
  return (
    result.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || ""
  );
}

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

describe("grep tool", () => {
  it("should respect global limit and include context lines", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "context.txt");
        const content = ["before", "match one", "after", "middle", "match two", "after two"].join(
          "\n",
        );
        yield* writeTextFile(testFile, content);

        const result = yield* awaited(
          grepTool.execute("test-call-12", {
            pattern: "match",
            path: testFile,
            limit: 1,
            context: 1,
          }),
        );

        const output = getTextOutput(result);
        expect(output).toContain("context.txt-1- before");
        expect(output).toContain("context.txt:2: match one");
        expect(output).toContain("context.txt-3- after");
        expect(output).toContain(
          "[1 matches limit reached. Use limit=2 for more, or refine pattern]",
        );

        expect(output).not.toContain("match two");
      }),
    ));

  it("should treat flag-like patterns as search text", () =>
    runTest(
      Effect.gen(function* () {
        const marker = joinPath(testDir, "grep-injection-marker");
        const payload = joinPath(testDir, "payload.sh");
        const testFile = joinPath(testDir, "target.txt");
        yield* writeTextFile(payload, `#!/bin/sh\necho executed > ${marker}\ncat "$1"\n`);
        yield* changeMode(payload, 0o755);
        yield* writeTextFile(testFile, "target\n");

        const result = yield* awaited(
          grepTool.execute("test-call-grep-injection", {
            pattern: `--pre=${payload}`,
            path: testDir,
          }),
        );

        expect(getTextOutput(result)).toContain("No matches found");
        expect(yield* pathExists(marker)).toBe(false);
      }),
    ));
});

describe("find tool", () => {
  it("should include hidden files that are not gitignored", () =>
    runTest(
      Effect.gen(function* () {
        const hiddenDir = joinPath(testDir, ".secret");
        yield* makeDirectory(hiddenDir);
        yield* writeTextFile(joinPath(hiddenDir, "hidden.txt"), "hidden");
        yield* writeTextFile(joinPath(testDir, "visible.txt"), "visible");

        const result = yield* awaited(
          findTool.execute("test-call-13", {
            pattern: "**/*.txt",
            path: testDir,
          }),
        );

        const outputLines = getTextOutput(result)
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

        expect(outputLines).toContain("visible.txt");
        expect(outputLines).toContain(".secret/hidden.txt");
      }),
    ));

  it("should respect .gitignore", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(testDir, ".gitignore"), "ignored.txt\n");
        yield* writeTextFile(joinPath(testDir, "ignored.txt"), "ignored");
        yield* writeTextFile(joinPath(testDir, "kept.txt"), "kept");

        const result = yield* awaited(
          findTool.execute("test-call-14", {
            pattern: "**/*.txt",
            path: testDir,
          }),
        );

        const output = getTextOutput(result);
        expect(output).toContain("kept.txt");
        expect(output).not.toContain("ignored.txt");
      }),
    ));

  it("should surface fd glob parse errors", () =>
    runTest(
      awaited(
        expect(
          findTool.execute("test-call-15", {
            pattern: "[",
            path: testDir,
          }),
        ).rejects.toThrow(/error parsing glob|fd exited with code 1|fd error/iu),
      ),
    ));

  it("should treat flag-like patterns as search text", () =>
    runTest(
      Effect.gen(function* () {
        const result = yield* awaited(
          findTool.execute("test-call-find-flag-pattern", {
            pattern: "--help",
            path: testDir,
          }),
        );

        expect(getTextOutput(result)).toContain("No files found matching pattern");
      }),
    ));
});

describe("ls tool", () => {
  it("should list dotfiles and directories", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(testDir, ".hidden-file"), "secret");
        yield* makeDirectory(joinPath(testDir, ".hidden-dir"));

        const result = yield* awaited(lsTool.execute("test-call-15", { path: testDir }));
        const output = getTextOutput(result);

        expect(output).toContain(".hidden-file");
        expect(output).toContain(".hidden-dir/");
      }),
    ));
});

describe("tool cwd resolution", () => {
  it("read uses ctx.cwd when provided", () =>
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
    ));

  it("write uses ctx.cwd when provided", () =>
    runTest(
      Effect.gen(function* () {
        const tool = createWriteToolDefinition("/");
        yield* awaited(
          tool.execute(
            "test-write-ctx-cwd",
            { path: "ctx-cwd-write.txt", content: "written via ctx.cwd" },
            undefined,
            undefined,
            fakeCtx(testDir),
          ),
        );
        const content = yield* readTextFile(joinPath(testDir, "ctx-cwd-write.txt"));
        expect(content).toBe("written via ctx.cwd");
      }),
    ));

  it("edit uses ctx.cwd when provided", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "ctx-cwd-edit.txt");
        yield* writeTextFile(testFile, "old text");
        const tool = createEditToolDefinition("/");
        yield* awaited(
          tool.execute(
            "test-edit-ctx-cwd",
            { path: "ctx-cwd-edit.txt", edits: [{ oldText: "old text", newText: "new text" }] },
            undefined,
            undefined,
            fakeCtx(testDir),
          ),
        );
        const content = yield* readTextFile(testFile);
        expect(content).toBe("new text");
      }),
    ));

  it("grep uses ctx.cwd when provided", () =>
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
    ));
});
