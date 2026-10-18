import {
  awaited,
  runTest,
  readBytesFile,
  readTextFile,
  writeTextFile,
  joinPath,
  makeTempDir,
  removePath,
} from "@msa/testing";
import { applyPatch } from "diff";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

describe("edit tool fuzzy matching", () => {
  it("should detect duplicates after fuzzy normalization", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "fuzzy-dups.txt");

        yield* writeTextFile(testFile, "hello world   \nhello world\n");

        yield* awaited(
          expect(
            editTool.execute("test-fuzzy-8", {
              path: testFile,
              edits: [{ oldText: "hello world", newText: "replaced" }],
            }),
          ).rejects.toThrow(/Found 2 occurrences/u),
        );
      }),
    ));

  it("should support fuzzy matching in multi-edit mode", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "fuzzy-multi.txt");
        yield* writeTextFile(testFile, "console.log(\u2018hello\u2019);\nhello\u00A0world\n");

        yield* awaited(
          editTool.execute("test-fuzzy-9", {
            path: testFile,
            edits: [
              { oldText: "console.log('hello');\n", newText: "console.log('world');\n" },
              { oldText: "hello world\n", newText: "hello universe\n" },
            ],
          }),
        );

        expect(yield* readTextFile(testFile)).toBe("console.log('world');\nhello universe\n");
      }),
    ));

  it("should preserve the correct occurrence when fuzzy replacement equals a nearby line", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "fuzzy-preserve-duplicate-line.txt");
        const originalContent = [
          "replace me\u0020\u0020\u0020",
          "after\u0020\u0020\u0020",
          "",
        ].join("\n");
        yield* writeTextFile(testFile, originalContent);

        const result = yield* awaited(
          editTool.execute("test-fuzzy-preserve-duplicate-line", {
            path: testFile,
            edits: [{ oldText: "replace me\n", newText: "after\n" }],
          }),
        );

        const expectedContent = ["after", "after\u0020\u0020\u0020", ""].join("\n");
        expect(yield* readTextFile(testFile)).toBe(expectedContent);
        expect(applyPatch(originalContent, result.details?.patch ?? "")).toBe(expectedContent);
      }),
    ));

  it("should preserve untouched lines and produce an applicable patch for fuzzy multi-edits", () =>
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
            path: testFile,
            edits: [
              { oldText: "first target\nfirst after", newText: "FIRST\nFIRST2" },
              { oldText: "second target\nsecond after", newText: "SECOND\nSECOND2" },
            ],
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
    ));
});

describe("edit tool CRLF handling", () => {
  it("should match LF oldText against CRLF file content", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "crlf-test.txt");

        yield* writeTextFile(testFile, "line one\r\nline two\r\nline three\r\n");

        const result = yield* awaited(
          editTool.execute("test-crlf-1", {
            path: testFile,
            edits: [{ oldText: "line two\n", newText: "replaced line\n" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
      }),
    ));

  it("should preserve CRLF line endings after edit", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "crlf-preserve.txt");
        yield* writeTextFile(testFile, "first\r\nsecond\r\nthird\r\n");

        yield* awaited(
          editTool.execute("test-crlf-2", {
            path: testFile,
            edits: [{ oldText: "second\n", newText: "REPLACED\n" }],
          }),
        );

        const content = yield* readTextFile(testFile);
        expect(content).toBe("first\r\nREPLACED\r\nthird\r\n");
      }),
    ));

  it("should preserve LF line endings for LF files", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "lf-preserve.txt");
        yield* writeTextFile(testFile, "first\nsecond\nthird\n");

        yield* awaited(
          editTool.execute("test-lf-1", {
            path: testFile,
            edits: [{ oldText: "second\n", newText: "REPLACED\n" }],
          }),
        );

        const content = yield* readTextFile(testFile);
        expect(content).toBe("first\nREPLACED\nthird\n");
      }),
    ));

  it("should detect duplicates across CRLF/LF variants", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "mixed-endings.txt");

        yield* writeTextFile(testFile, "hello\r\nworld\r\n---\r\nhello\nworld\n");

        yield* awaited(
          expect(
            editTool.execute("test-crlf-dup", {
              path: testFile,
              edits: [{ oldText: "hello\nworld\n", newText: "replaced\n" }],
            }),
          ).rejects.toThrow(/Found 2 occurrences/u),
        );
      }),
    ));

  it("should preserve UTF-8 BOM after edit", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "bom-test.txt");
        yield* writeTextFile(testFile, "\uFEFFfirst\r\nsecond\r\nthird\r\n");

        yield* awaited(
          editTool.execute("test-bom", {
            path: testFile,
            edits: [{ oldText: "second\n", newText: "REPLACED\n" }],
          }),
        );

        const content = readKeepingBom(yield* readBytesFile(testFile));
        expect(content).toBe("\uFEFFfirst\r\nREPLACED\r\nthird\r\n");
      }),
    ));

  it("should preserve CRLF line endings and BOM in multi-edit mode", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "bom-crlf-multi.txt");
        yield* writeTextFile(testFile, "\uFEFFfirst\r\nsecond\r\nthird\r\nfourth\r\n");

        yield* awaited(
          editTool.execute("test-crlf-multi", {
            path: testFile,
            edits: [
              { oldText: "second\n", newText: "SECOND\n" },
              { oldText: "fourth\n", newText: "FOURTH\n" },
            ],
          }),
        );

        const content = readKeepingBom(yield* readBytesFile(testFile));
        expect(content).toBe("\uFEFFfirst\r\nSECOND\r\nthird\r\nFOURTH\r\n");
      }),
    ));
});
