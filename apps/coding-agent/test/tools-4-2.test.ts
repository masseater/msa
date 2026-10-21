import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import bash from "../src/core/tools/bash.ts";
import shellModule from "../src/utils/shell.ts";

const { createBashTool, createLocalBashOperations } = bash;

const { awaited, joinPath, makeTempDir, removePath, runTest, writeTextFile } = testing;

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

const shouldSendCommandsOverStdinWhenShell = () =>
  runTest(
    Effect.gen(function* () {
      vi.spyOn(shellModule, "getShellConfig").mockReturnValue({
        args: [
          "-e",
          'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { input += chunk; }); process.stdin.on("end", () => { process.stdout.write(input); });',
        ],
        commandTransport: "stdin",
        shell: process.execPath,
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
  );

const shouldResolveLegacyWslBashExeTo = () =>
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
          args: ["-s"],
          commandTransport: "stdin",
          shell: shellPath,
        });
      } finally {
        process.chdir(originalCwd);
        if (platformDescriptor !== undefined) {
          Object.defineProperty(process, "platform", platformDescriptor);
        }
      }
    }),
  );

const shouldPrependCommandPrefixWhenConfigured = () =>
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
  );

const shouldIncludeOutputFromBothPrefixAnd = () =>
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
  );

describe("bash tool", () => {
  it(
    "should send commands over stdin when shell resolution requires it",
    shouldSendCommandsOverStdinWhenShell,
  );

  it(
    "should resolve legacy WSL bash.exe to stdin command transport",
    shouldResolveLegacyWslBashExeTo,
  );

  it("should prepend command prefix when configured", shouldPrependCommandPrefixWhenConfigured);

  it("should include output from both prefix and command", shouldIncludeOutputFromBothPrefixAnd);
});
