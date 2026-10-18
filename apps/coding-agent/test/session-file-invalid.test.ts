import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  awaited,
  runTest,
  readTextFile,
  writeTextFile,
  makeDirectory,
  joinPath,
  resolvePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { envSnapshot } from "../src/core/process-env.ts";

const cliPath = resolvePath(__dirname, "../src/cli.ts");

const sourceResolverUrl = pathToFileURL(
  resolvePath(__dirname, "../src/experimental/source-resolver.ts"),
).href;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = realpathSync(mkdtempSync(joinPath(tmpdir(), "msa-session-file-invalid-")));
  tempDirs.push(dir);
  return dir;
}

function runCli(
  args: string[],
  cwd: string,
  agentDir: string,
): Promise<{ code: number | null; stderr: string }> {
  return runTest(
    Effect.gen(function* () {
      let stderr = "";
      const code = yield* awaited(
        new Promise<number | null>((resolvePromise, reject) => {
          const child = spawn(process.execPath, ["--import", sourceResolverUrl, cliPath, ...args], {
            cwd,
            env: {
              ...envSnapshot(),
              [ENV_AGENT_DIR]: agentDir,
              MSA_OFFLINE: "1",
            },
            stdio: ["ignore", "ignore", "pipe"],
          });
          child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
          });
          child.on("error", reject);
          child.on("close", resolvePromise);
        }),
      );

      return yield* awaited({ code, stderr });
    }),
  );
}

describe("--session invalid file handling", () => {
  it("prints a friendly error and preserves non-session file content", () =>
    runTest(
      Effect.gen(function* () {
        const tempRoot = createTempDir();
        const agentDir = joinPath(tempRoot, "agent");
        const projectDir = joinPath(tempRoot, "project");
        const sessionFile = joinPath(tempRoot, "not-a-session.log");
        const originalContent = '{"type":"event","data":"not a session"}\n';
        yield* makeDirectory(agentDir);
        yield* makeDirectory(projectDir);
        yield* writeTextFile(sessionFile, originalContent);

        const result = yield* awaited(
          runCli(["--session", sessionFile, "-p", "hi"], projectDir, agentDir),
        );

        expect(result.code).toBe(1);
        expect(result.stderr).toContain(
          `Error: Session file is not a valid msa session: ${sessionFile}`,
        );
        expect(result.stderr).not.toContain("SessionManager.open");
        expect(result.stderr).not.toContain("at ");
        expect(yield* readTextFile(sessionFile)).toBe(originalContent);
      }),
    ));
});
