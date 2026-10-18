import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { createPowerShellTool } from "../src/tools/index.ts";
import { awaited } from "./effect-support.ts";
import { programsEnv } from "./tools-programs-env-support.ts";
import { run, runFailing, removeTempDirs } from "./tools-support.ts";

afterAll(() => Effect.runPromise(removeTempDirs));

const runsCommandPwsh = Effect.gen(function* () {
  const { env, commands } = yield* programsEnv(["pwsh"], "héllo\n");
  const result = yield* awaited(
    run(createPowerShellTool(), { command: "Write-Output 'héllo'" }, env),
  );
  expect(result.streamed.join("")).toBe("héllo\n");
  expect(commands).toEqual([
    [
      "pwsh",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\nWrite-Output 'héllo'",
    ],
  ]);
});

const fallsBackWindows = Effect.gen(function* () {
  const windowsOnly = yield* programsEnv(["powershell"], "ok");
  const result = yield* awaited(
    run(createPowerShellTool({ commandPrefix: "$x = 1" }), { command: "$x" }, windowsOnly.env),
  );
  expect(result.streamed.join("")).toBe("ok");
  expect(windowsOnly.commands.map((command) => command[0])).toEqual(["pwsh", "powershell"]);
  expect(String(windowsOnly.commands[1]?.at(-1))).toMatch(/\n\$x = 1\n\$x$/u);

  const none = yield* programsEnv([], "");
  const failed = yield* runFailing(createPowerShellTool(), { command: "1" }, none.env);
  expect(failed.error.message).toBe("spawn powershell ENOENT");
});

const answersNonzeroExit = Effect.gen(function* () {
  const { env } = yield* programsEnv(["pwsh"], "partial", 3);
  const result = yield* awaited(run(createPowerShellTool(), { command: "exit 3" }, env));
  expect(result).toMatchObject({
    isError: true,
    structuredOutput: { output: "partial", truncated: false, exitCode: 3 },
    diagnostics: [{ severity: "error", code: "exit_code", message: "Command exited with code 3" }],
  });
  expect(result.streamed.join("")).toBe("partial");
});

describe("durable tools", () => {
  describe("powershell", () => {
    it("runs the command with pwsh as one argument, forcing UTF-8 output", () =>
      Effect.runPromise(runsCommandPwsh));

    it("falls back to Windows PowerShell and reports the last start failure", () =>
      Effect.runPromise(fallsBackWindows));

    it("answers a nonzero exit with an error result carrying the exit code", () =>
      Effect.runPromise(answersNonzeroExit));
  });
});
