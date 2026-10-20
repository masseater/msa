import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import src from "../src/index.ts";
import tools6Support from "./tools-6-support.ts";

const { createFindTool, createGrepTool, createLsTool } = src;

const { getTextOutput } = tools6Support;

const {
  awaited,
  changeMode,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  removePath,
  runTest,
  writeTextFile,
} = testing;

const grepTool = createGrepTool(process.cwd());

const findTool = createFindTool(process.cwd());

const lsTool = createLsTool(process.cwd());

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

const shouldRespectGlobalLimitAndIncludeContext = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "context.txt");
      const content = ["before", "match one", "after", "middle", "match two", "after two"].join(
        "\n",
      );
      yield* writeTextFile(testFile, content);

      const result = yield* awaited(
        grepTool.execute("test-call-12", {
          context: 1,
          limit: 1,
          path: testFile,
          pattern: "match",
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
  );

const shouldTreatFlagLikePatternsAsSearch = () =>
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
          path: testDir,
          pattern: `--pre=${payload}`,
        }),
      );

      expect(getTextOutput(result)).toContain("No matches found");
      expect(yield* pathExists(marker)).toBe(false);
    }),
  );

describe("grep tool", () => {
  it(
    "should respect global limit and include context lines",
    shouldRespectGlobalLimitAndIncludeContext,
  );

  it("should treat flag-like patterns as search text", shouldTreatFlagLikePatternsAsSearch);
});

const shouldIncludeHiddenFilesThatAreNot = () =>
  runTest(
    Effect.gen(function* () {
      const hiddenDir = joinPath(testDir, ".secret");
      yield* makeDirectory(hiddenDir);
      yield* writeTextFile(joinPath(hiddenDir, "hidden.txt"), "hidden");
      yield* writeTextFile(joinPath(testDir, "visible.txt"), "visible");

      const result = yield* awaited(
        findTool.execute("test-call-13", {
          path: testDir,
          pattern: "**/*.txt",
        }),
      );

      const outputLines = getTextOutput(result)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      expect(outputLines).toContain("visible.txt");
      expect(outputLines).toContain(".secret/hidden.txt");
    }),
  );

const shouldRespectGitignore = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(testDir, ".gitignore"), "ignored.txt\n");
      yield* writeTextFile(joinPath(testDir, "ignored.txt"), "ignored");
      yield* writeTextFile(joinPath(testDir, "kept.txt"), "kept");

      const result = yield* awaited(
        findTool.execute("test-call-14", {
          path: testDir,
          pattern: "**/*.txt",
        }),
      );

      const output = getTextOutput(result);
      expect(output).toContain("kept.txt");
      expect(output).not.toContain("ignored.txt");
    }),
  );

const shouldSurfaceFdGlobParseErrors = () =>
  runTest(
    awaited(
      expect(
        findTool.execute("test-call-15", {
          path: testDir,
          pattern: "[",
        }),
      ).rejects.toThrow(/error parsing glob|fd exited with code 1|fd error/iu),
    ),
  );

const shouldTreatFlagLikePatternsAsSearch2 = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        findTool.execute("test-call-find-flag-pattern", {
          path: testDir,
          pattern: "--help",
        }),
      );

      expect(getTextOutput(result)).toContain("No files found matching pattern");
    }),
  );

describe("find tool", () => {
  it("should include hidden files that are not gitignored", shouldIncludeHiddenFilesThatAreNot);

  it("should respect .gitignore", shouldRespectGitignore);

  it("should surface fd glob parse errors", shouldSurfaceFdGlobParseErrors);

  it("should treat flag-like patterns as search text", shouldTreatFlagLikePatternsAsSearch2);
});

const shouldListDotfilesAndDirectories = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(joinPath(testDir, ".hidden-file"), "secret");
      yield* makeDirectory(joinPath(testDir, ".hidden-dir"));

      const result = yield* awaited(lsTool.execute("test-call-15", { path: testDir }));
      const output = getTextOutput(result);

      expect(output).toContain(".hidden-file");
      expect(output).toContain(".hidden-dir/");
    }),
  );

describe("ls tool", () => {
  it("should list dotfiles and directories", shouldListDotfilesAndDirectories);
});
