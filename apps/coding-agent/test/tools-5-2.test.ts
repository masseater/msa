import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import src from "../src/index.ts";
import tools5Support from "./tools-5-support.ts";

const { createGrepTool } = src;

const { getTextOutput } = tools5Support;

const { awaited, joinPath, makeTempDir, removePath, runTest, writeTextFile } = testing;

const grepTool = createGrepTool(process.cwd());

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

const shouldIncludeFilenameWhenSearchingASingle = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "example.txt");
      yield* writeTextFile(testFile, "first line\nmatch line\nlast line");

      const result = yield* awaited(
        grepTool.execute("test-call-11", {
          path: testFile,
          pattern: "match",
        }),
      );

      const output = getTextOutput(result);
      expect(output).toContain("example.txt:2: match line");
    }),
  );

describe("grep tool", () => {
  it(
    "should include filename when searching a single file",
    shouldIncludeFilenameWhenSearchingASingle,
  );
});
