import * as Effect from "effect/Effect";

import platformModule from "./platform/index.ts";
import nodeChildProcess from "./platform/node/child-process.ts";
import type nodeChildProcessTypes from "./platform/node/child-process.types.ts";

const { execFile } = nodeChildProcess;
const { readEnv } = platformModule;

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
  shouldPollGitHead,
};

export default footerDataProviderHelpers;
