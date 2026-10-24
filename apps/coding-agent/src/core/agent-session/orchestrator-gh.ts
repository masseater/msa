import shell from "../../utils/shell.ts";
import execModule from "../exec.ts";
import type orchestratorTypes from "../orchestrator/orchestrator.types.ts";

const { execCommand } = execModule;
const { findExecutableOnPath } = shell;

const GH_TIMEOUT_MS = 120_000;

function runGh(args: readonly string[], cwd: string): Promise<orchestratorTypes.GhResult> {
  if (findExecutableOnPath("gh") === null) {
    return Promise.resolve({ code: 127, stderr: "gh is not on PATH", stdout: "" });
  }
  return execCommand("gh", [...args], cwd, { timeout: GH_TIMEOUT_MS }).then(
    (result) => ({ code: result.code, stderr: result.stderr, stdout: result.stdout }),
    (error: unknown) => ({
      code: 1,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: "",
    }),
  );
}

const orchestratorGh = { runGh };

export default orchestratorGh;
