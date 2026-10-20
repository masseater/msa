import * as Effect from "effect/Effect";

import nodeChildProcess from "./platform/node/child-process.ts";
import type nodeChildProcessTypes from "./platform/node/child-process.types.ts";
import processEnv from "./process-env.ts";

const { execFile, spawnSync } = nodeChildProcess;
const { readEnv } = processEnv;

function resolveBranchWithGitSync(repoDir: string): string | null {
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
    {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const branch = result.status === 0 ? result.stdout.trim() : "";
  return branch || null;
}

function resolveBranchWithGitAsync(repoDir: string): Promise<string | null> {
  return Effect.runPromise(
    Effect.callback<string | null>((resume) => {
      execFile(
        "git",
        ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
        {
          cwd: repoDir,
          encoding: "utf8",
        },
        (error: nodeChildProcessTypes.ExecFileException | null, stdout: string) => {
          if (error !== null) {
            resume(Effect.succeed(null));
            return;
          }
          const branch = stdout.trim();
          resume(Effect.succeed(branch === "" ? null : branch));
        },
      );
    }),
  );
}

function isWslEnvironment(): boolean {
  return (
    process.platform === "linux" &&
    ((readEnv("WSL_DISTRO_NAME") ?? "") !== "" || (readEnv("WSL_INTEROP") ?? "") !== "")
  );
}

function isWindowsMountedRepoPath(repoDir: string): boolean {
  return /^\/mnt\/[a-z](?:\/|$)/iu.test(repoDir);
}

function shouldPollGitHead(repoDir: string): boolean {
  return isWslEnvironment() && isWindowsMountedRepoPath(repoDir);
}

const footerDataProviderHelpers = {
  isWindowsMountedRepoPath,
  isWslEnvironment,
  resolveBranchWithGitAsync,
  resolveBranchWithGitSync,
  shouldPollGitHead,
};

export default footerDataProviderHelpers;
