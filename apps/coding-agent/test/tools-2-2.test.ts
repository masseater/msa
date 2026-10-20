import testing from "@msa/testing";
import { applyPatch } from "diff";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import src from "../src/index.ts";
import tools2Support from "./tools-2-support.ts";

const { createEditTool } = src;

const { getTextOutput } = tools2Support;

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

const shouldReplaceTextInFile = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-test.txt");
      const originalContent = "Hello, world!";
      yield* writeTextFile(testFile, originalContent);

      const result = yield* awaited(
        editTool.execute("test-call-5", {
          edits: [{ newText: "testing", oldText: "world" }],
          path: testFile,
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
  );

const shouldFailIfTextNotFound = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-test.txt");
      const originalContent = "Hello, world!";
      yield* writeTextFile(testFile, originalContent);

      yield* awaited(
        expect(
          editTool.execute("test-call-6", {
            edits: [{ newText: "testing", oldText: "nonexistent" }],
            path: testFile,
          }),
        ).rejects.toThrow(/Could not find the exact text/u),
      );
    }),
  );

const shouldIncludeEnoentWhenTheEditTarget = () =>
  runTest(
    Effect.gen(function* () {
      const missingFile = joinPath(testDir, "missing.txt");

      yield* awaited(
        expect(
          editTool.execute("test-call-6b", {
            edits: [{ newText: "world", oldText: "hello" }],
            path: missingFile,
          }),
        ).rejects.toThrow(`Could not edit file: ${missingFile}. Error code: ENOENT.`),
      );
    }),
  );

const shouldFailIfTextAppearsMultipleTimes = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-test.txt");
      const originalContent = "foo foo foo";
      yield* writeTextFile(testFile, originalContent);

      yield* awaited(
        expect(
          editTool.execute("test-call-7", {
            edits: [{ newText: "bar", oldText: "foo" }],
            path: testFile,
          }),
        ).rejects.toThrow(/Found 3 occurrences/u),
      );
    }),
  );

const shouldReplaceMultipleDisjointRegionsInOne = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-multi.txt");
      yield* writeTextFile(testFile, "alpha\nbeta\ngamma\ndelta\n");

      const result = yield* awaited(
        editTool.execute("test-call-8", {
          edits: [
            { newText: "ALPHA\n", oldText: "alpha\n" },
            { newText: "GAMMA\n", oldText: "gamma\n" },
          ],
          path: testFile,
        }),
      );

      expect(getTextOutput(result)).toContain("Successfully replaced 2 block(s)");
      expect(yield* readTextFile(testFile)).toBe("ALPHA\nbeta\nGAMMA\ndelta\n");
      expect(result.details?.diff).toContain("ALPHA");
      expect(result.details?.diff).toContain("GAMMA");
    }),
  );

const shouldCollapseLargeUnchangedGapsInMulti = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-multi-large-gap.txt");
      const lines = Array.from({ length: 600 }, (_, i) => `line ${String(i + 1).padStart(3, "0")}`);
      yield* writeTextFile(testFile, `${lines.join("\n")}\n`);

      const result = yield* awaited(
        editTool.execute("test-call-8b", {
          edits: [
            { newText: "LINE 100\n", oldText: "line 100\n" },
            { newText: "LINE 300\n", oldText: "line 300\n" },
            { newText: "LINE 500\n", oldText: "line 500\n" },
          ],
          path: testFile,
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
  );

const shouldMatchEditsAgainstTheOriginalFile = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-multi-original.txt");
      yield* writeTextFile(testFile, "foo\nbar\nbaz\n");

      yield* awaited(
        editTool.execute("test-call-9", {
          edits: [
            { newText: "foo bar\n", oldText: "foo\n" },
            { newText: "BAR\n", oldText: "bar\n" },
          ],
          path: testFile,
        }),
      );

      expect(yield* readTextFile(testFile)).toBe("foo bar\nBAR\nbaz\n");
    }),
  );

const shouldFailWhenEditsIsEmpty = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-empty-edits.txt");
      yield* writeTextFile(testFile, "hello\nworld\n");

      yield* awaited(
        expect(
          editTool.execute("test-call-11", {
            edits: [],
            path: testFile,
          }),
        ).rejects.toThrow(/edits must contain at least one replacement/u),
      );
    }),
  );

const shouldFailWhenMultiEditRegionsOverlap = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-overlap.txt");
      yield* writeTextFile(testFile, "one\ntwo\nthree\n");

      yield* awaited(
        expect(
          editTool.execute("test-call-12", {
            edits: [
              { newText: "ONE\nTWO\n", oldText: "one\ntwo\n" },
              { newText: "TWO\nTHREE\n", oldText: "two\nthree\n" },
            ],
            path: testFile,
          }),
        ).rejects.toThrow(/overlap/u),
      );
    }),
  );

describe("edit tool", () => {
  it("should replace text in file", shouldReplaceTextInFile);

  it("should fail if text not found", shouldFailIfTextNotFound);

  it(
    "should include ENOENT when the edit target does not exist",
    shouldIncludeEnoentWhenTheEditTarget,
  );

  it("should fail if text appears multiple times", shouldFailIfTextAppearsMultipleTimes);

  it(
    "should replace multiple disjoint regions in one call",
    shouldReplaceMultipleDisjointRegionsInOne,
  );

  it(
    "should collapse large unchanged gaps in multi-edit diffs",
    shouldCollapseLargeUnchangedGapsInMulti,
  );

  it(
    "should match edits against the original file, not incrementally",
    shouldMatchEditsAgainstTheOriginalFile,
  );

  it("should fail when edits is empty", shouldFailWhenEditsIsEmpty);

  it("should fail when multi-edit regions overlap", shouldFailWhenMultiEditRegionsOverlap);
});
