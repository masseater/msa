import {
  awaited,
  runTest,
  readTextFile,
  writeTextFile,
  joinPath,
  makeTempDir,
  removePath,
} from "@msa/testing";
import { applyPatch } from "diff";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEditTool, createReadTool, createWriteTool } from "../src/index.ts";

const readTool = createReadTool(process.cwd());
const writeTool = createWriteTool(process.cwd());
const editTool = createEditTool(process.cwd());

function getTextOutput(result: any): string {
  return (
    result.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || ""
  );
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

describe("read tool", () => {
  it("should treat files with image extension but non-image content as text", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "not-an-image.png");
        yield* writeTextFile(testFile, "definitely not a png");

        const result = yield* awaited(readTool.execute("test-call-img-2", { path: testFile }));
        const output = getTextOutput(result);

        expect(output).toContain("definitely not a png");
        expect(result.content.some((c: any) => c.type === "image")).toBe(false);
      }),
    ));
});

describe("write tool", () => {
  it("should write file contents", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "write-test.txt");
        const content = "Test content";

        const result = yield* awaited(
          writeTool.execute("test-call-3", { path: testFile, content }),
        );

        expect(getTextOutput(result)).toBe(`Successfully wrote to ${testFile}`);
        expect(result.details).toBeUndefined();
      }),
    ));

  it("should create parent directories", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "nested", "dir", "test.txt");
        const content = "Nested content";

        const result = yield* awaited(
          writeTool.execute("test-call-4", { path: testFile, content }),
        );

        expect(getTextOutput(result)).toContain("Successfully wrote");
      }),
    ));
});

describe("edit tool", () => {
  it("should replace text in file", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "edit-test.txt");
        const originalContent = "Hello, world!";
        yield* writeTextFile(testFile, originalContent);

        const result = yield* awaited(
          editTool.execute("test-call-5", {
            path: testFile,
            edits: [{ oldText: "world", newText: "testing" }],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced");
        expect(result.details).toBeDefined();
        expect(result.details.diff).toBeDefined();
        expect(typeof result.details.diff).toBe("string");
        expect(result.details.diff).toContain("testing");
        expect(result.details.patch).toContain("--- ");
        expect(result.details.patch).toContain("+++ ");
        expect(result.details.patch).toContain("@@");
        expect(result.details.patch).toContain("-Hello, world!");
        expect(result.details.patch).toContain("+Hello, testing!");
        expect(applyPatch(originalContent, result.details.patch)).toBe("Hello, testing!");
      }),
    ));

  it("should fail if text not found", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "edit-test.txt");
        const originalContent = "Hello, world!";
        yield* writeTextFile(testFile, originalContent);

        yield* awaited(
          expect(
            editTool.execute("test-call-6", {
              path: testFile,
              edits: [{ oldText: "nonexistent", newText: "testing" }],
            }),
          ).rejects.toThrow(/Could not find the exact text/u),
        );
      }),
    ));

  it("should include ENOENT when the edit target does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const missingFile = joinPath(testDir, "missing.txt");

        yield* awaited(
          expect(
            editTool.execute("test-call-6b", {
              path: missingFile,
              edits: [{ oldText: "hello", newText: "world" }],
            }),
          ).rejects.toThrow(`Could not edit file: ${missingFile}. Error code: ENOENT.`),
        );
      }),
    ));

  it("should fail if text appears multiple times", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "edit-test.txt");
        const originalContent = "foo foo foo";
        yield* writeTextFile(testFile, originalContent);

        yield* awaited(
          expect(
            editTool.execute("test-call-7", {
              path: testFile,
              edits: [{ oldText: "foo", newText: "bar" }],
            }),
          ).rejects.toThrow(/Found 3 occurrences/u),
        );
      }),
    ));

  it("should replace multiple disjoint regions in one call", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "edit-multi.txt");
        yield* writeTextFile(testFile, "alpha\nbeta\ngamma\ndelta\n");

        const result = yield* awaited(
          editTool.execute("test-call-8", {
            path: testFile,
            edits: [
              { oldText: "alpha\n", newText: "ALPHA\n" },
              { oldText: "gamma\n", newText: "GAMMA\n" },
            ],
          }),
        );

        expect(getTextOutput(result)).toContain("Successfully replaced 2 block(s)");
        expect(yield* readTextFile(testFile)).toBe("ALPHA\nbeta\nGAMMA\ndelta\n");
        expect(result.details?.diff).toContain("ALPHA");
        expect(result.details?.diff).toContain("GAMMA");
      }),
    ));

  it("should collapse large unchanged gaps in multi-edit diffs", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "edit-multi-large-gap.txt");
        const lines = Array.from(
          { length: 600 },
          (_, i) => `line ${String(i + 1).padStart(3, "0")}`,
        );
        yield* writeTextFile(testFile, `${lines.join("\n")}\n`);

        const result = yield* awaited(
          editTool.execute("test-call-8b", {
            path: testFile,
            edits: [
              { oldText: "line 100\n", newText: "LINE 100\n" },
              { oldText: "line 300\n", newText: "LINE 300\n" },
              { oldText: "line 500\n", newText: "LINE 500\n" },
            ],
          }),
        );

        const diff = result.details?.diff ?? "";
        expect(diff).toContain("LINE 100");
        expect(diff).toContain("LINE 300");
        expect(diff).toContain("LINE 500");
        expect(diff).toContain("...");
        expect(diff).not.toContain("line 250");
        expect(diff.split("\n").length).toBeLessThan(50);
      }),
    ));

  it("should match edits against the original file, not incrementally", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "edit-multi-original.txt");
        yield* writeTextFile(testFile, "foo\nbar\nbaz\n");

        yield* awaited(
          editTool.execute("test-call-9", {
            path: testFile,
            edits: [
              { oldText: "foo\n", newText: "foo bar\n" },
              { oldText: "bar\n", newText: "BAR\n" },
            ],
          }),
        );

        expect(yield* readTextFile(testFile)).toBe("foo bar\nBAR\nbaz\n");
      }),
    ));

  it("should fail when edits is empty", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "edit-empty-edits.txt");
        yield* writeTextFile(testFile, "hello\nworld\n");

        yield* awaited(
          expect(
            editTool.execute("test-call-11", {
              path: testFile,
              edits: [],
            }),
          ).rejects.toThrow(/edits must contain at least one replacement/u),
        );
      }),
    ));

  it("should fail when multi-edit regions overlap", () =>
    runTest(
      Effect.gen(function* () {
        const testFile = joinPath(testDir, "edit-overlap.txt");
        yield* writeTextFile(testFile, "one\ntwo\nthree\n");

        yield* awaited(
          expect(
            editTool.execute("test-call-12", {
              path: testFile,
              edits: [
                { oldText: "one\ntwo\n", newText: "ONE\nTWO\n" },
                { oldText: "two\nthree\n", newText: "TWO\nTHREE\n" },
              ],
            }),
          ).rejects.toThrow(/overlap/u),
        );
      }),
    ));
});
