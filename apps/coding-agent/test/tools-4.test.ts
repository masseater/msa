import testing from "@msa/testing";
import { Cause, Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import bashModule from "../src/core/tools/bash.ts";
import type bashTypes from "../src/core/tools/bash.types.ts";
import shellModule from "../src/utils/shell.ts";

const { createBashTool, createLocalBashOperations } = bashModule;

const { awaited, makeTempDir, pathExists, readTextFile, removePath, runTest, toJsonText } = testing;

const bashTool = createBashTool(process.cwd());

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

const shouldRejectANullExitCodeFrom = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const operations: bashTypes.BashOperations = {
        exec: (_command, _cwd, { onData }) =>
          effectRunPromise(
            Effect.gen(function* () {
              onData(Buffer.from("partial\n", "utf-8"));
              return yield* awaited({ exitCode: null });
            }),
          ),
      };
      const bash = createBashTool(testDir, { operations });

      yield* awaited(
        expect(bash.execute("test-call-null-exit", { command: "remote" })).rejects.toThrow(
          /partial\s+Command terminated without an exit code$/u,
        ),
      );
    }),
  );

const shouldRespectTimeout = () =>
  runTest(
    Effect.gen(function* () {
      const command = `${yield* toJsonText(process.execPath)} -e ${yield* toJsonText("setInterval(() => {}, 1000)")}`;
      yield* awaited(
        expect(bashTool.execute("test-call-10", { command, timeout: 0.05 })).rejects.toThrow(
          /timed out/iu,
        ),
      );
    }),
  );

const shouldIncludeFullOutputPathForTruncated = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      for (const testCase of [
        { error: "timeout:5", expected: "Command timed out after 5 seconds" },
        { error: "aborted", expected: "Command aborted" },
      ]) {
        const operations: bashTypes.BashOperations = {
          exec: (_command, _cwd, { onData }) =>
            effectRunPromise(
              Effect.sync(() => {
                for (let i = 1; i <= 3000; i++) {
                  onData(Buffer.from(`${i}\n`, "utf-8"));
                }
                throw new Error(testCase.error);
              }),
            ),
        };
        const bash = createBashTool(testDir, { operations });

        const exit = yield* Effect.exit(
          awaited(bash.execute(`test-call-${testCase.error}`, { command: "chatty-fail" })),
        );

        const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain(testCase.expected);
        expect(message).toMatch(/\[Showing lines \d+-\d+ of \d+\. Full output: /u);
        expect(message).not.toContain("Full output: undefined");
        const fullOutputPath = message.match(/Full output: ([^\]\n]+)/u)?.[1];
        expect(fullOutputPath).toBeDefined();
        expect(yield* pathExists(fullOutputPath!)).toBe(true);
        const fullOutput = yield* readTextFile(fullOutputPath!);
        expect(fullOutput).toContain("1\n2\n3");
        expect(fullOutput).toContain("2998\n2999\n3000");
      }
    }),
  );

const shouldThrowErrorWhenCwdDoesNot = () =>
  runTest(
    Effect.gen(function* () {
      const nonexistentCwd = "/this/directory/definitely/does/not/exist/12345";

      const bashToolWithBadCwd = createBashTool(nonexistentCwd);

      yield* awaited(
        expect(
          bashToolWithBadCwd.execute("test-call-11", { command: "echo test" }),
        ).rejects.toThrow(/Working directory does not exist/u),
      );
    }),
  );

const shouldHandleProcessSpawnErrors = () =>
  runTest(
    Effect.gen(function* () {
      vi.spyOn(shellModule, "getShellConfig").mockReturnValueOnce({
        args: ["-c"],
        shell: "/nonexistent-shell-path-xyz123",
      });

      const bashWithBadShell = createBashTool(testDir);

      yield* awaited(
        expect(bashWithBadShell.execute("test-call-12", { command: "echo test" })).rejects.toThrow(
          /ENOENT/u,
        ),
      );
    }),
  );

const shouldPassShellpathThroughToShellResolution = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const getShellConfigSpy = vi.spyOn(shellModule, "getShellConfig");
      const bashWithCustomShell = createBashTool(testDir, {
        operations: {
          exec: () => effectRunPromise(awaited({ exitCode: 0 })),
        },
        shellPath: "/custom/bash",
      });

      yield* awaited(bashWithCustomShell.execute("test-call-12b", { command: "echo test" }));

      expect(getShellConfigSpy).not.toHaveBeenCalled();

      const ops = createLocalBashOperations({ shellPath: "/custom/bash" });
      yield* awaited(
        expect(
          ops.exec("echo test", testDir, {
            onData: () => {},
          }),
        ).rejects.toThrow("Custom shell path not found: /custom/bash"),
      );
      expect(getShellConfigSpy).toHaveBeenCalledWith("/custom/bash");
    }),
  );

describe("bash tool", () => {
  it("should reject a null exit code from custom operations", shouldRejectANullExitCodeFrom);

  it("should respect timeout", shouldRespectTimeout);

  it(
    "should include full output path for truncated timeout and abort errors",
    shouldIncludeFullOutputPathForTruncated,
  );

  it("should throw error when cwd does not exist", shouldThrowErrorWhenCwdDoesNot);

  it("should handle process spawn errors", shouldHandleProcessSpawnErrors);

  it(
    "should pass shellPath through to shell resolution",
    shouldPassShellpathThroughToShellResolution,
  );
});
