import {
  awaited,
  runTest,
  toJsonText,
  readTextFile,
  writeTextFile,
  pathExists,
  joinPath,
  makeTempDir,
  removePath,
} from "@msa/testing";
import { Effect, Cause, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type BashOperations,
  createBashTool,
  createLocalBashOperations,
} from "../src/core/tools/bash.ts";
import * as shellModule from "../src/utils/shell.ts";

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

describe("bash tool", () => {
  it("should reject a null exit code from custom operations", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const operations: BashOperations = {
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
    ));

  it("should respect timeout", () =>
    runTest(
      Effect.gen(function* () {
        const command = `${yield* toJsonText(process.execPath)} -e ${yield* toJsonText("setInterval(() => {}, 1000)")}`;
        yield* awaited(
          expect(bashTool.execute("test-call-10", { command, timeout: 0.05 })).rejects.toThrow(
            /timed out/iu,
          ),
        );
      }),
    ));

  it("should include full output path for truncated timeout and abort errors", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        for (const testCase of [
          { error: "timeout:5", expected: "Command timed out after 5 seconds" },
          { error: "aborted", expected: "Command aborted" },
        ]) {
          const operations: BashOperations = {
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
    ));

  it("should throw error when cwd does not exist", () =>
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
    ));

  it("should handle process spawn errors", () =>
    runTest(
      Effect.gen(function* () {
        vi.spyOn(shellModule, "getShellConfig").mockReturnValueOnce({
          shell: "/nonexistent-shell-path-xyz123",
          args: ["-c"],
        });

        const bashWithBadShell = createBashTool(testDir);

        yield* awaited(
          expect(
            bashWithBadShell.execute("test-call-12", { command: "echo test" }),
          ).rejects.toThrow(/ENOENT/u),
        );
      }),
    ));

  it("should pass shellPath through to shell resolution", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const getShellConfigSpy = vi.spyOn(shellModule, "getShellConfig");
        const bashWithCustomShell = createBashTool(testDir, {
          shellPath: "/custom/bash",
          operations: {
            exec: () => effectRunPromise(awaited({ exitCode: 0 })),
          },
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
    ));

  it("should send commands over stdin when shell resolution requires it", () =>
    runTest(
      Effect.gen(function* () {
        vi.spyOn(shellModule, "getShellConfig").mockReturnValue({
          shell: process.execPath,
          args: [
            "-e",
            'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { input += chunk; }); process.stdin.on("end", () => { process.stdout.write(input); });',
          ],
          commandTransport: "stdin",
        });
        const chunks: Buffer[] = [];
        const ops = createLocalBashOperations({ shellPath: "C:\\Windows\\System32\\bash.exe" });
        const nameExpansion = "${name}";
        const countExpansion = "${count}";
        const iExpansion = "${i}";
        const command = `name='World'; echo "Hello, ${nameExpansion}!"; count=3; for i in $(seq 1 ${countExpansion}); do echo "Iteration ${iExpansion} of ${countExpansion}"; done`;

        const result = yield* awaited(
          ops.exec(command, testDir, {
            onData: (data) => chunks.push(data),
          }),
        );

        expect(result.exitCode).toBe(0);
        expect(Buffer.concat(chunks).toString("utf-8")).toBe(command);
      }),
    ));

  it("should resolve legacy WSL bash.exe to stdin command transport", () =>
    runTest(
      Effect.gen(function* () {
        if (process.platform === "win32") return;
        const originalCwd = process.cwd();
        const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
        const shellPath = "C:\\Windows\\System32\\bash.exe";
        yield* writeTextFile(joinPath(testDir, shellPath), "");
        try {
          process.chdir(testDir);
          Object.defineProperty(process, "platform", {
            configurable: true,
            value: "win32",
          });

          expect(shellModule.getShellConfig(shellPath)).toEqual({
            shell: shellPath,
            args: ["-s"],
            commandTransport: "stdin",
          });
        } finally {
          process.chdir(originalCwd);
          if (platformDescriptor !== undefined) {
            Object.defineProperty(process, "platform", platformDescriptor);
          }
        }
      }),
    ));

  it("should prepend command prefix when configured", () =>
    runTest(
      Effect.gen(function* () {
        const bashWithPrefix = createBashTool(testDir, {
          commandPrefix: "export TEST_VAR=hello",
        });

        const result = yield* awaited(
          bashWithPrefix.execute("test-prefix-1", { command: "echo $TEST_VAR" }),
        );
        expect(getTextOutput(result).trim()).toBe("hello");
      }),
    ));

  it("should include output from both prefix and command", () =>
    runTest(
      Effect.gen(function* () {
        const bashWithPrefix = createBashTool(testDir, {
          commandPrefix: "echo prefix-output",
        });

        const result = yield* awaited(
          bashWithPrefix.execute("test-prefix-2", {
            command: "echo command-output",
          }),
        );
        expect(getTextOutput(result).trim()).toBe("prefix-output\ncommand-output");
      }),
    ));
});
