import {
  awaited,
  runTest,
  readTextFile,
  writeTextFile,
  joinPath,
  makeTempDir,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { createFindToolDefinition } from "../src/core/tools/find.ts";
import { createLsToolDefinition } from "../src/core/tools/ls.ts";
import { createEditTool } from "../src/index.ts";

const editTool = createEditTool(process.cwd());

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

describe("tool cwd resolution", () => {
  it("find uses ctx.cwd when provided", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(testDir, "ctx-cwd-find.txt"), "find me");
        const tool = createFindToolDefinition("/");
        const result = yield* awaited(
          tool.execute(
            "test-find-ctx-cwd",
            { pattern: "ctx-cwd-find.txt" },
            undefined,
            undefined,
            fakeCtx(testDir),
          ),
        );
        const output = getTextOutput(result);
        expect(output).toContain("ctx-cwd-find.txt");
      }),
    ));

  it("ls uses ctx.cwd when provided", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(joinPath(testDir, "ctx-cwd-ls.txt"), "list me");
        const tool = createLsToolDefinition("/");
        const result = yield* awaited(
          tool.execute("test-ls-ctx-cwd", {}, undefined, undefined, fakeCtx(testDir)),
        );
        const output = getTextOutput(result);
        expect(output).toContain("ctx-cwd-ls.txt");
      }),
    ));

  it("bash uses ctx.cwd when provided", () =>
    runTest(
      Effect.gen(function* () {
        const tool = createBashToolDefinition("/", { exposeSessionEnvironment: false });
        const result = yield* awaited(
          tool.execute(
            "test-bash-ctx-cwd",
            { command: "pwd" },
            undefined,
            undefined,
            fakeCtx(testDir),
          ),
        );
        const output = getTextOutput(result);
        expect(output).toContain(testDir);
      }),
    ));
});

describe("edit tool fuzzy matching", () => {
  it("should match text with trailing whitespace stripped", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "trailing-ws.txt");

        yield* writeTextFile(testFile, "line one   \nline two  \nline three\n");

        const result = yield* awaited(
          editTool.execute("test-fuzzy-1", {
            path: testFile,
            edits: [{ oldText: "line one\nline two\n", newText: "replaced\n" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        const content = yield* readTextFile(testFile);
        expect(content).toBe("replaced\nline three\n");
      }),
    ));

  it("should match fullwidth punctuation in Chinese text", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "chinese-punctuation.txt");
        yield* writeTextFile(testFile, "你好，世界\n你好（世界）\n");

        const result = yield* awaited(
          editTool.execute("test-fuzzy-chinese", {
            path: testFile,
            edits: [{ oldText: "你好,世界\n你好(世界)\n", newText: "你好，msa\n你好(msa)\n" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        const content = yield* readTextFile(testFile);
        expect(content).toBe("你好，msa\n你好(msa)\n");
      }),
    ));

  it("should match compatibility-equivalent Unicode forms", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "unicode-compatibility.txt");
        yield* writeTextFile(testFile, "ＡＢＣ１２３\ncafe\u0301\n");

        const result = yield* awaited(
          editTool.execute("test-fuzzy-unicode", {
            path: testFile,
            edits: [{ oldText: "ABC123\ncafé\n", newText: "XYZ789\ncoffee\n" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        const content = yield* readTextFile(testFile);
        expect(content).toBe("XYZ789\ncoffee\n");
      }),
    ));

  it("should match smart single quotes to ASCII quotes", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "smart-quotes.txt");

        yield* writeTextFile(testFile, "console.log(\u2018hello\u2019);\n");

        const result = yield* awaited(
          editTool.execute("test-fuzzy-2", {
            path: testFile,
            edits: [{ oldText: "console.log('hello');", newText: "console.log('world');" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        const content = yield* readTextFile(testFile);
        expect(content).toContain("world");
      }),
    ));

  it("should match smart double quotes to ASCII quotes", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "smart-double-quotes.txt");

        yield* writeTextFile(testFile, "const msg = \u201CHello World\u201D;\n");

        const result = yield* awaited(
          editTool.execute("test-fuzzy-3", {
            path: testFile,
            edits: [{ oldText: 'const msg = "Hello World";', newText: 'const msg = "Goodbye";' }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        const content = yield* readTextFile(testFile);
        expect(content).toContain("Goodbye");
      }),
    ));

  it("should match Unicode dashes to ASCII hyphen", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "unicode-dashes.txt");

        yield* writeTextFile(testFile, "range: 1\u20135\nbreak\u2014here\n");

        const result = yield* awaited(
          editTool.execute("test-fuzzy-4", {
            path: testFile,
            edits: [{ oldText: "range: 1-5\nbreak-here", newText: "range: 10-50\nbreak--here" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        const content = yield* readTextFile(testFile);
        expect(content).toContain("10-50");
      }),
    ));

  it("should match non-breaking space to regular space", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "nbsp.txt");

        yield* writeTextFile(testFile, "hello\u00A0world\n");

        const result = yield* awaited(
          editTool.execute("test-fuzzy-5", {
            path: testFile,
            edits: [{ oldText: "hello world", newText: "hello universe" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        const content = yield* readTextFile(testFile);
        expect(content).toContain("universe");
      }),
    ));

  it("should prefer exact match over fuzzy match", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "exact-preferred.txt");

        yield* writeTextFile(testFile, "const x = 'exact';\nconst y = 'other';\n");

        const result = yield* awaited(
          editTool.execute("test-fuzzy-6", {
            path: testFile,
            edits: [{ oldText: "const x = 'exact';", newText: "const x = 'changed';" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        const content = yield* readTextFile(testFile);
        expect(content).toBe("const x = 'changed';\nconst y = 'other';\n");
      }),
    ));

  it("should still fail when text is not found even with fuzzy matching", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "no-match.txt");
        yield* writeTextFile(testFile, "completely different content\n");

        yield* awaited(
          expect(
            editTool.execute("test-fuzzy-7", {
              path: testFile,
              edits: [{ oldText: "this does not exist", newText: "replacement" }],
            }),
          ).rejects.toThrow(/Could not find the exact text/u),
        );
      }),
    ));
});
