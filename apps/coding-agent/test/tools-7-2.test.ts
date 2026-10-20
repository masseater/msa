import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEditTool } from "../src/index.ts";
import tools7Support from "./tools-7-support.ts";

const { getTextOutput } = tools7Support;

const { awaited, joinPath, makeTempDir, readTextFile, removePath, runTest, writeTextFile } =
  testing;

const editTool = createEditTool(process.cwd());

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

const shouldMatchTextWithTrailingWhitespaceStripped = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "trailing-ws.txt");

      yield* writeTextFile(testFile, "line one   \nline two  \nline three\n");

      const result = yield* awaited(
        editTool.execute("test-fuzzy-1", {
          edits: [{ newText: "replaced\n", oldText: "line one\nline two\n" }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
      const content = yield* readTextFile(testFile);
      expect(content).toBe("replaced\nline three\n");
    }),
  );

const shouldMatchFullwidthPunctuationInChineseText = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "chinese-punctuation.txt");
      yield* writeTextFile(testFile, "你好，世界\n你好（世界）\n");

      const result = yield* awaited(
        editTool.execute("test-fuzzy-chinese", {
          edits: [{ newText: "你好，msa\n你好(msa)\n", oldText: "你好,世界\n你好(世界)\n" }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
      const content = yield* readTextFile(testFile);
      expect(content).toBe("你好，msa\n你好(msa)\n");
    }),
  );

const shouldMatchCompatibilityEquivalentUnicodeForms = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "unicode-compatibility.txt");
      yield* writeTextFile(testFile, "ＡＢＣ１２３\ncafe\u0301\n");

      const result = yield* awaited(
        editTool.execute("test-fuzzy-unicode", {
          edits: [{ newText: "XYZ789\ncoffee\n", oldText: "ABC123\ncafé\n" }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
      const content = yield* readTextFile(testFile);
      expect(content).toBe("XYZ789\ncoffee\n");
    }),
  );

const shouldMatchSmartSingleQuotesToAscii = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "smart-quotes.txt");

      yield* writeTextFile(testFile, "console.log(\u2018hello\u2019);\n");

      const result = yield* awaited(
        editTool.execute("test-fuzzy-2", {
          edits: [{ newText: "console.log('world');", oldText: "console.log('hello');" }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
      const content = yield* readTextFile(testFile);
      expect(content).toContain("world");
    }),
  );

const shouldMatchSmartDoubleQuotesToAscii = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "smart-double-quotes.txt");

      yield* writeTextFile(testFile, "const msg = \u201CHello World\u201D;\n");

      const result = yield* awaited(
        editTool.execute("test-fuzzy-3", {
          edits: [{ newText: 'const msg = "Goodbye";', oldText: 'const msg = "Hello World";' }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
      const content = yield* readTextFile(testFile);
      expect(content).toContain("Goodbye");
    }),
  );

const shouldMatchUnicodeDashesToAsciiHyphen = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "unicode-dashes.txt");

      yield* writeTextFile(testFile, "range: 1\u20135\nbreak\u2014here\n");

      const result = yield* awaited(
        editTool.execute("test-fuzzy-4", {
          edits: [{ newText: "range: 10-50\nbreak--here", oldText: "range: 1-5\nbreak-here" }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
      const content = yield* readTextFile(testFile);
      expect(content).toContain("10-50");
    }),
  );

const shouldMatchNonBreakingSpaceToRegular = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "nbsp.txt");

      yield* writeTextFile(testFile, "hello\u00A0world\n");

      const result = yield* awaited(
        editTool.execute("test-fuzzy-5", {
          edits: [{ newText: "hello universe", oldText: "hello world" }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
      const content = yield* readTextFile(testFile);
      expect(content).toContain("universe");
    }),
  );

const shouldPreferExactMatchOverFuzzyMatch = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "exact-preferred.txt");

      yield* writeTextFile(testFile, "const x = 'exact';\nconst y = 'other';\n");

      const result = yield* awaited(
        editTool.execute("test-fuzzy-6", {
          edits: [{ newText: "const x = 'changed';", oldText: "const x = 'exact';" }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
      const content = yield* readTextFile(testFile);
      expect(content).toBe("const x = 'changed';\nconst y = 'other';\n");
    }),
  );

const shouldStillFailWhenTextIsNot = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "no-match.txt");
      yield* writeTextFile(testFile, "completely different content\n");

      yield* awaited(
        expect(
          editTool.execute("test-fuzzy-7", {
            edits: [{ newText: "replacement", oldText: "this does not exist" }],
            path: testFile,
          }),
        ).rejects.toThrow(/Could not find the exact text/u),
      );
    }),
  );

describe("edit tool fuzzy matching", () => {
  it(
    "should match text with trailing whitespace stripped",
    shouldMatchTextWithTrailingWhitespaceStripped,
  );

  it(
    "should match fullwidth punctuation in Chinese text",
    shouldMatchFullwidthPunctuationInChineseText,
  );

  it(
    "should match compatibility-equivalent Unicode forms",
    shouldMatchCompatibilityEquivalentUnicodeForms,
  );

  it("should match smart single quotes to ASCII quotes", shouldMatchSmartSingleQuotesToAscii);

  it("should match smart double quotes to ASCII quotes", shouldMatchSmartDoubleQuotesToAscii);

  it("should match Unicode dashes to ASCII hyphen", shouldMatchUnicodeDashesToAsciiHyphen);

  it("should match non-breaking space to regular space", shouldMatchNonBreakingSpaceToRegular);

  it("should prefer exact match over fuzzy match", shouldPreferExactMatchOverFuzzyMatch);

  it(
    "should still fail when text is not found even with fuzzy matching",
    shouldStillFailWhenTextIsNot,
  );
});
