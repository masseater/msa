import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import src from "../src/index.ts";
import tools2Support from "./tools-2-support.ts";

const { createReadTool, createWriteTool } = src;

const { getTextOutput } = tools2Support;

const { awaited, joinPath, makeTempDir, removePath, runTest, writeTextFile } = testing;

const readTool = createReadTool(process.cwd());

const writeTool = createWriteTool(process.cwd());

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

const shouldTreatFilesWithImageExtensionBut = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "not-an-image.png");
      yield* writeTextFile(testFile, "definitely not a png");

      const result = yield* awaited(readTool.execute("test-call-img-2", { path: testFile }));
      const output = getTextOutput(result);

      expect(output).toContain("definitely not a png");
      expect(result.content.some((c: any) => c.type === "image")).toBe(false);
    }),
  );

describe("read tool", () => {
  it(
    "should treat files with image extension but non-image content as text",
    shouldTreatFilesWithImageExtensionBut,
  );
});

const shouldWriteFileContents = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "write-test.txt");
      const content = "Test content";

      const result = yield* awaited(writeTool.execute("test-call-3", { content, path: testFile }));

      expect(getTextOutput(result)).toBe(`Successfully wrote to ${testFile}`);
      expect(result.details).toBeUndefined();
    }),
  );

const shouldCreateParentDirectories = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "nested", "dir", "test.txt");
      const content = "Nested content";

      const result = yield* awaited(writeTool.execute("test-call-4", { content, path: testFile }));

      expect(getTextOutput(result)).toContain("Successfully wrote");
    }),
  );

describe("write tool", () => {
  it("should write file contents", shouldWriteFileContents);

  it("should create parent directories", shouldCreateParentDirectories);
});
