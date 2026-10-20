import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createBashTool, createLocalBashOperations } from "../src/core/tools/bash.ts";
import { computeEditsDiff } from "../src/core/tools/edit-diff.ts";
import { createEditTool } from "../src/index.ts";

const {
  awaited,
  changeMode,
  joinPath,
  makeTempDir,
  readTextFile,
  removePath,
  runTest,
  writeTextFile,
} = testing;

const editTool = createEditTool(process.cwd());
const bashTool = createBashTool(process.cwd());

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

const shouldNotPartiallyApplyEditsWhenOne = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-no-partial.txt");
      const originalContent = "alpha\nbeta\ngamma\n";
      yield* writeTextFile(testFile, originalContent);

      yield* awaited(
        expect(
          editTool.execute("test-call-13", {
            edits: [
              { newText: "ALPHA\n", oldText: "alpha\n" },
              { newText: "MISSING\n", oldText: "missing\n" },
            ],
            path: testFile,
          }),
        ).rejects.toThrow(/Could not find/u),
      );

      expect(yield* readTextFile(testFile)).toBe(originalContent);
    }),
  );

const shouldIncludeEaccesForReadOnlyFiles = () =>
  runTest(
    Effect.gen(function* () {
      const testFile = joinPath(testDir, "edit-readonly.txt");
      yield* writeTextFile(testFile, "hello\n");
      yield* changeMode(testFile, 0o444);

      yield* awaited(
        expect(
          editTool.execute("test-call-14", {
            edits: [{ newText: "world", oldText: "hello" }],
            path: testFile,
          }),
        ).rejects.toThrow(`Could not edit file: ${testFile}. Error code: EACCES.`),
      );
    }),
  );

const shouldIncludeTheOriginalErrorMessageFor = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const genericFailureTool = createEditTool(testDir, {
        operations: {
          access: () =>
            effectRunPromise(
              Effect.sync(() => {
                throw new Error("disk offline");
              }),
            ),
          readFile: () => effectRunPromise(awaited(Buffer.from("hello\n", "utf-8"))),
          writeFile: () => effectRunPromise(Effect.sync(() => {})),
        },
      });

      yield* awaited(
        expect(
          genericFailureTool.execute("test-call-16", {
            edits: [{ newText: "world", oldText: "hello" }],
            path: "broken.txt",
          }),
        ).rejects.toThrow("Could not edit file: broken.txt. Error: disk offline."),
      );
    }),
  );

const shouldIncludeEnoentInDiffPreviewFor = () =>
  runTest(
    Effect.gen(function* () {
      const missingFile = joinPath(testDir, "missing-preview.txt");
      const result = yield* awaited(
        computeEditsDiff(missingFile, [{ newText: "world", oldText: "hello" }], testDir),
      );

      expect(result).toEqual({
        error: `Could not edit file: ${missingFile}. Error code: ENOENT.`,
      });
    }),
  );

const shouldIncludeEaccesInDiffPreviewFor = () =>
  runTest(
    Effect.gen(function* () {
      const unreadableFile = joinPath(testDir, "unreadable-preview.txt");
      yield* writeTextFile(unreadableFile, "hello\n");
      yield* changeMode(unreadableFile, 0o222);

      const result = yield* awaited(
        computeEditsDiff(unreadableFile, [{ newText: "world", oldText: "hello" }], testDir),
      );

      expect(result).toEqual({
        error: `Could not edit file: ${unreadableFile}. Error code: EACCES.`,
      });
    }),
  );

describe("edit tool", () => {
  it("should not partially apply edits when one edit fails", shouldNotPartiallyApplyEditsWhenOne);

  it("should include EACCES for read-only files", shouldIncludeEaccesForReadOnlyFiles);

  it(
    "should include the original error message for unknown edit access errors",
    shouldIncludeTheOriginalErrorMessageFor,
  );

  it(
    "should include ENOENT in diff preview for missing files",
    shouldIncludeEnoentInDiffPreviewFor,
  );

  it(
    "should include EACCES in diff preview for unreadable files",
    shouldIncludeEaccesInDiffPreviewFor,
  );
});

const shouldExecuteSimpleCommands = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        bashTool.execute("test-call-8", { command: "echo 'test output'" }),
      );

      expect(getTextOutput(result)).toContain("test output");
      expect(result.details).toBeUndefined();
    }),
  );

const shouldReportNonZeroExitCodesAs = () =>
  runTest(
    Effect.gen(function* () {
      const result = yield* awaited(
        bashTool.execute("test-call-9", { command: "echo out; exit 3" }),
      );
      expect(result.isError).toBe(true);
      expect(getTextOutput(result)).toBe("out\n\n\nCommand exited with code 3");
      expect(result.structuredContent).toEqual({
        exit_code: 3,
        output: "out\n",
        truncated: false,
        wall_time_seconds: expect.any(Number),
      });

      const ok = yield* awaited(bashTool.execute("test-call-9b", { command: "echo fine" }));
      expect(ok.isError).toBeUndefined();
      expect(ok.structuredContent).toMatchObject({ exit_code: 0, output: "fine\n" });

      const empty = yield* awaited(bashTool.execute("test-call-9c", { command: "true" }));
      expect(getTextOutput(empty)).toBe("(no output)");
      expect(empty.structuredContent).toMatchObject({ output: "", truncated: false });
    }),
  );

const shouldReturnUpTo1MibOf = () =>
  runTest(
    Effect.gen(function* () {
      const medium = yield* awaited(bashTool.execute("test-call-9d", { command: "seq 1 3000" }));
      expect(getTextOutput(medium)).not.toContain("\n1\n2\n");
      expect(medium.details?.truncation?.truncated).toBe(true);
      const mediumOutput = medium.structuredContent as { output: string; truncated: boolean };
      expect(mediumOutput.truncated).toBe(false);
      expect(mediumOutput.output).toBe(
        `${Array.from({ length: 3000 }, (_, i) => i + 1).join("\n")}\n`,
      );

      const large = yield* awaited(bashTool.execute("test-call-9e", { command: "seq 1 300000" }));
      const largeOutput = large.structuredContent as {
        output: string;
        truncated: boolean;
        full_output_path?: string;
      };
      expect(largeOutput.truncated).toBe(true);
      expect(largeOutput.output.startsWith("1\n2\n3\n")).toBe(true);
      expect(largeOutput.output.endsWith("299999\n300000\n")).toBe(true);
      expect(largeOutput.output).toMatch(/\n\n\[\.\.\. \d+ bytes omitted \.\.\.\]\n\n/u);
      expect(Buffer.byteLength(largeOutput.output)).toBeLessThan(1024 * 1024 + 100);
      expect(largeOutput.full_output_path).toBe(large.details?.fullOutputPath);
      expect((yield* readTextFile(largeOutput.full_output_path!)).endsWith("300000\n")).toBe(true);
    }),
  );

const shouldMapSignalKilledCommandsTo128 = () =>
  runTest(
    Effect.gen(function* () {
      const operations = createLocalBashOperations();
      for (const { signal, exitCode } of [
        { exitCode: 137, signal: "KILL" },
        { exitCode: 143, signal: "TERM" },
      ]) {
        const result = yield* awaited(
          operations.exec(`kill -${signal} $$`, testDir, { onData: () => {} }),
        );
        expect(result.exitCode).toBe(exitCode);
      }
    }),
  );

const shouldReportSignalKilledCommandsAsErrors = () =>
  runTest(
    Effect.gen(function* () {
      for (const { signal, exitCode } of [
        { exitCode: 137, signal: "KILL" },
        { exitCode: 143, signal: "TERM" },
      ]) {
        const result = yield* awaited(
          bashTool.execute(`test-call-signal-${signal}`, {
            command: `printf 'before-kill\\n'; kill -${signal} $$`,
          }),
        );
        expect(result.isError).toBe(true);
        expect(getTextOutput(result)).toMatch(
          new RegExp(`before-kill\\s+Command exited with code ${exitCode}$`, "u"),
        );
      }
    }),
  );

describe("bash tool", () => {
  it("should execute simple commands", shouldExecuteSimpleCommands);

  it(
    "should report non-zero exit codes as error results with structured content",
    shouldReportNonZeroExitCodesAs,
  );

  it("should return up to 1 MiB of output in structured content", shouldReturnUpTo1MibOf);

  it.skipIf(process.platform === "win32")(
    "should map signal-killed commands to 128 plus the signal number",
    shouldMapSignalKilledCommandsTo128,
  );

  it.skipIf(process.platform === "win32")(
    "should report signal-killed commands as errors while preserving partial output",
    shouldReportSignalKilledCommandsAsErrors,
  );
});
