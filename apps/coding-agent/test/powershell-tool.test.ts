import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import powershell from "../src/core/tools/powershell.ts";
import shell from "../src/utils/shell.ts";

const { POWERSHELL_ARGS, getPowerShellConfig } = shell;
const { createPowerShellTool } = powershell;

const { awaited, runTest } = testing;

function getTextOutput(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("\n");
}

const usesProcessLocalExecutionPolicyBypass = () => {
  expect(POWERSHELL_ARGS).toEqual([
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
  ]);
};

const executesPowershellCommandsWithUtf8Output = () =>
  runTest(
    Effect.gen(function* () {
      const config = getPowerShellConfig();
      expect(config.args).toEqual(POWERSHELL_ARGS);

      const tool = createPowerShellTool(process.cwd());
      const result = yield* awaited(
        tool.execute("powershell-test", {
          command: "Write-Output 'héllo €'; Get-ExecutionPolicy -Scope Process",
        }),
      );
      const output = getTextOutput(result);

      expect(output).toContain("héllo €");
      expect(output).toContain("Bypass");
    }),
  );

describe("powershell tool", () => {
  it("uses process-local execution policy bypass", usesProcessLocalExecutionPolicyBypass);

  it.skipIf(process.platform !== "win32")(
    "executes PowerShell commands with UTF-8 output",
    executesPowershellCommandsWithUtf8Output,
  );
});
