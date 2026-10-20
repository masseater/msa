import testing from "@msa/testing";
import { applyPatch } from "diff";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import src from "../src/index.ts";

const { createEditTool } = src;

const {
  awaited,
  joinPath,
  makeTempDir,
  readBytesFile,
  readTextFile,
  removePath,
  runTest,
  writeTextFile,
} = testing;

const editTool = createEditTool(process.cwd());

function getTextOutput(result: any): string {
  return (
    result.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || ""
  );
}

const readKeepingBom = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

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

const shouldDetectDuplicatesAfterFuzzyNormalization = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "fuzzy-dups.txt");

      yield* writeTextFile(testFile, "hello world   \nhello world\n");

      yield* awaited(
        expect(
          editTool.execute("test-fuzzy-8", {
            edits: [{ newText: "replaced", oldText: "hello world" }],
            path: testFile,
          }),
        ).rejects.toThrow(/Found 2 occurrences/u),
      );
    }),
  );

const shouldSupportFuzzyMatchingInMultiEdit = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "fuzzy-multi.txt");
      yield* writeTextFile(testFile, "console.log(\u2018hello\u2019);\nhello\u00A0world\n");

      yield* awaited(
        editTool.execute("test-fuzzy-9", {
          edits: [
            { newText: "console.log('world');\n", oldText: "console.log('hello');\n" },
            { newText: "hello universe\n", oldText: "hello world\n" },
          ],
          path: testFile,
        }),
      );

      expect(yield* readTextFile(testFile)).toBe("console.log('world');\nhello universe\n");
    }),
  );

const shouldPreserveTheCorrectOccurrenceWhenFuzzy = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "fuzzy-preserve-duplicate-line.txt");
      const originalContent = ["replace me\u0020\u0020\u0020", "after\u0020\u0020\u0020", ""].join(
        "\n",
      );
      yield* writeTextFile(testFile, originalContent);

      const result = yield* awaited(
        editTool.execute("test-fuzzy-preserve-duplicate-line", {
          edits: [{ newText: "after\n", oldText: "replace me\n" }],
          path: testFile,
        }),
      );

      const expectedContent = ["after", "after\u0020\u0020\u0020", ""].join("\n");
      expect(yield* readTextFile(testFile)).toBe(expectedContent);
      expect(applyPatch(originalContent, result.details?.patch ?? "")).toBe(expectedContent);
    }),
  );

const shouldPreserveUntouchedLinesAndProduceAn = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "fuzzy-preserve-multi.txt");
      const originalContent = [
        "keep before\u0020\u0020",
        "first target\u0020\u0020",
        "first after",
        "keep middle\u0020\u0020\u0020",
        "second target\u0020\u0020",
        "second after",
        "keep after\u0020\u0020",
        "",
      ].join("\n");
      yield* writeTextFile(testFile, originalContent);

      const result = yield* awaited(
        editTool.execute("test-fuzzy-preserve-multi", {
          edits: [
            { newText: "FIRST\nFIRST2", oldText: "first target\nfirst after" },
            { newText: "SECOND\nSECOND2", oldText: "second target\nsecond after" },
          ],
          path: testFile,
        }),
      );

      const expectedContent = [
        "keep before\u0020\u0020",
        "FIRST",
        "FIRST2",
        "keep middle\u0020\u0020\u0020",
        "SECOND",
        "SECOND2",
        "keep after\u0020\u0020",
        "",
      ].join("\n");
      expect(yield* readTextFile(testFile)).toBe(expectedContent);
      expect(applyPatch(originalContent, result.details?.patch ?? "")).toBe(expectedContent);
    }),
  );

describe("edit tool fuzzy matching", () => {
  it(
    "should detect duplicates after fuzzy normalization",
    shouldDetectDuplicatesAfterFuzzyNormalization,
  );

  it("should support fuzzy matching in multi-edit mode", shouldSupportFuzzyMatchingInMultiEdit);

  it(
    "should preserve the correct occurrence when fuzzy replacement equals a nearby line",
    shouldPreserveTheCorrectOccurrenceWhenFuzzy,
  );

  it(
    "should preserve untouched lines and produce an applicable patch for fuzzy multi-edits",
    shouldPreserveUntouchedLinesAndProduceAn,
  );
});

const shouldMatchLfOldtextAgainstCrlfFile = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "crlf-test.txt");

      yield* writeTextFile(testFile, "line one\r\nline two\r\nline three\r\n");

      const result = yield* awaited(
        editTool.execute("test-crlf-1", {
          edits: [{ newText: "replaced line\n", oldText: "line two\n" }],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced");
    }),
  );

const shouldPreserveCrlfLineEndingsAfterEdit = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "crlf-preserve.txt");
      yield* writeTextFile(testFile, "first\r\nsecond\r\nthird\r\n");

      yield* awaited(
        editTool.execute("test-crlf-2", {
          edits: [{ newText: "REPLACED\n", oldText: "second\n" }],
          path: testFile,
        }),
      );

      const content = yield* readTextFile(testFile);
      expect(content).toBe("first\r\nREPLACED\r\nthird\r\n");
    }),
  );

const shouldPreserveLfLineEndingsForLf = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "lf-preserve.txt");
      yield* writeTextFile(testFile, "first\nsecond\nthird\n");

      yield* awaited(
        editTool.execute("test-lf-1", {
          edits: [{ newText: "REPLACED\n", oldText: "second\n" }],
          path: testFile,
        }),
      );

      const content = yield* readTextFile(testFile);
      expect(content).toBe("first\nREPLACED\nthird\n");
    }),
  );

const shouldDetectDuplicatesAcrossCrlfLfVariants = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "mixed-endings.txt");

      yield* writeTextFile(testFile, "hello\r\nworld\r\n---\r\nhello\nworld\n");

      yield* awaited(
        expect(
          editTool.execute("test-crlf-dup", {
            edits: [{ newText: "replaced\n", oldText: "hello\nworld\n" }],
            path: testFile,
          }),
        ).rejects.toThrow(/Found 2 occurrences/u),
      );
    }),
  );

const shouldPreserveUtf8BomAfterEdit = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "bom-test.txt");
      yield* writeTextFile(testFile, "\uFEFFfirst\r\nsecond\r\nthird\r\n");

      yield* awaited(
        editTool.execute("test-bom", {
          edits: [{ newText: "REPLACED\n", oldText: "second\n" }],
          path: testFile,
        }),
      );

      const content = readKeepingBom(yield* readBytesFile(testFile));
      expect(content).toBe("\uFEFFfirst\r\nREPLACED\r\nthird\r\n");
    }),
  );

const shouldPreserveCrlfLineEndingsAndBom = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "bom-crlf-multi.txt");
      yield* writeTextFile(testFile, "\uFEFFfirst\r\nsecond\r\nthird\r\nfourth\r\n");

      yield* awaited(
        editTool.execute("test-crlf-multi", {
          edits: [
            { newText: "SECOND\n", oldText: "second\n" },
            { newText: "FOURTH\n", oldText: "fourth\n" },
          ],
          path: testFile,
        }),
      );

      const content = readKeepingBom(yield* readBytesFile(testFile));
      expect(content).toBe("\uFEFFfirst\r\nSECOND\r\nthird\r\nFOURTH\r\n");
    }),
  );

describe("edit tool CRLF handling", () => {
  it("should match LF oldText against CRLF file content", shouldMatchLfOldtextAgainstCrlfFile);

  it("should preserve CRLF line endings after edit", shouldPreserveCrlfLineEndingsAfterEdit);

  it("should preserve LF line endings for LF files", shouldPreserveLfLineEndingsForLf);

  it(
    "should detect duplicates across CRLF/LF variants",
    shouldDetectDuplicatesAcrossCrlfLfVariants,
  );

  it("should preserve UTF-8 BOM after edit", shouldPreserveUtf8BomAfterEdit);

  it(
    "should preserve CRLF line endings and BOM in multi-edit mode",
    shouldPreserveCrlfLineEndingsAndBom,
  );
});
