import { Effect } from "effect";

import nodeChildProcess from "../../core/platform/node/child-process.ts";
import type sessionShareTypes from "./session-share.types.ts";

function githubCliProblem(): string | undefined {
  try {
    const authResult = nodeChildProcess.spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
    return authResult.status === 0
      ? undefined
      : "GitHub CLI is not logged in. Run 'gh auth login' first.";
  } catch {
    return "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/";
  }
}

function createSecretGist(file: string): {
  result: Effect.Effect<sessionShareTypes.GistResult>;
  cancel: () => void;
} {
  let proc: ReturnType<typeof nodeChildProcess.spawn> | null = null;
  const result = Effect.callback<sessionShareTypes.GistResult>((resume) => {
    proc = nodeChildProcess.spawn("gh", ["gist", "create", "--public=false", file]);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => resume(Effect.succeed({ code, stderr, stdout })));
  });
  return { cancel: () => proc?.kill(), result };
}

const githubGist = {
  createSecretGist,
  githubCliProblem,
};

export default githubGist;
