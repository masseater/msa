import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import commandRunner from "./command-runner.ts";
import packageEnv from "./package-env.ts";

const { NETWORK_TIMEOUT_MS, isOfflineModeEnabled } = packageEnv;
const { awaited, awaiting, performed } = awaitingModule;

function gitHasAvailableUpdate(installedPath: string): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      if (isOfflineModeEnabled()) {
        return false;
      }

      try {
        const localHead = yield* awaited(
          commandRunner.runCommandCapture("git", ["rev-parse", "HEAD"], {
            cwd: installedPath,
            timeoutMs: NETWORK_TIMEOUT_MS,
          }),
        );
        const remoteHead = yield* performed(getRemoteGitHead(installedPath));
        return localHead.trim() !== remoteHead.trim();
      } catch {
        return false;
      }
    }),
  );
}

function getRemoteGitHead(installedPath: string): Effect.Effect<string> {
  return awaiting(function* () {
    const upstreamRef = yield* performed(getGitUpstreamRef(installedPath));
    if (upstreamRef !== undefined && upstreamRef !== "") {
      const remoteHead = yield* awaited(
        runGitRemoteCommand(installedPath, ["ls-remote", "origin", upstreamRef]),
      );
      const match = remoteHead.match(/^([0-9a-f]{40})\s+/mu);
      if (match?.[1] !== undefined && match?.[1] !== "") {
        return match[1];
      }
    }

    const remoteHead = yield* awaited(
      runGitRemoteCommand(installedPath, ["ls-remote", "origin", "HEAD"]),
    );
    const match = remoteHead.match(/^([0-9a-f]{40})\s+HEAD$/mu);
    if (match?.[1] === undefined || match?.[1] === "") {
      throw new Error("Failed to determine remote HEAD");
    }
    return match[1];
  });
}

type GitUpdateTarget = { ref: string; head: string; fetchArgs: string[] };

const branchFetchArgs = (branch: string): string[] => [
  "fetch",
  "--prune",
  "--no-tags",
  "origin",
  `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
];

const capture = (installedPath: string, args: string[]) =>
  commandRunner.runCommandCapture("git", args, {
    cwd: installedPath,
    timeoutMs: NETWORK_TIMEOUT_MS,
  });

function upstreamTarget(installedPath: string): Promise<GitUpdateTarget> {
  return Effect.runPromise(
    awaiting(function* () {
      const upstream = yield* awaited(
        capture(installedPath, ["rev-parse", "--abbrev-ref", "@{upstream}"]),
      );
      const trimmedUpstream = upstream.trim();
      if (!trimmedUpstream.startsWith("origin/")) {
        throw new Error(`Unsupported upstream remote: ${trimmedUpstream}`);
      }
      const branch = trimmedUpstream.slice("origin/".length);
      if (branch === "") {
        throw new Error("Missing upstream branch name");
      }
      const head = yield* awaited(capture(installedPath, ["rev-parse", "@{upstream}"]));
      return { fetchArgs: branchFetchArgs(branch), head, ref: "@{upstream}" };
    }),
  );
}

function originHeadTarget(installedPath: string): Promise<GitUpdateTarget> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(
        commandRunner
          .runCommand("git", ["remote", "set-head", "origin", "-a"], { cwd: installedPath })
          .catch(() => {}),
      );
      const head = yield* awaited(capture(installedPath, ["rev-parse", "origin/HEAD"]));
      const originHeadRef = yield* awaited(
        capture(installedPath, ["symbolic-ref", "refs/remotes/origin/HEAD"]).catch(() => ""),
      );
      const branch = originHeadRef.trim().replace(/^refs\/remotes\/origin\//u, "");
      if (branch !== "") {
        return { fetchArgs: branchFetchArgs(branch), head, ref: "origin/HEAD" };
      }
      return {
        fetchArgs: ["fetch", "--prune", "--no-tags", "origin", "+HEAD:refs/remotes/origin/HEAD"],
        head,
        ref: "origin/HEAD",
      };
    }),
  );
}

function getLocalGitUpdateTarget(installedPath: string): Promise<GitUpdateTarget> {
  return upstreamTarget(installedPath).catch(() => originHeadTarget(installedPath));
}

function getGitUpstreamRef(installedPath: string): Effect.Effect<string | undefined> {
  return awaiting(function* () {
    try {
      const upstream = yield* awaited(
        commandRunner.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
          cwd: installedPath,
          timeoutMs: NETWORK_TIMEOUT_MS,
        }),
      );
      const trimmed = upstream.trim();
      if (!trimmed.startsWith("origin/")) {
        return undefined;
      }
      const branch = trimmed.slice("origin/".length);
      return branch === "" ? undefined : `refs/heads/${branch}`;
    } catch {
      return undefined;
    }
  });
}

function runGitRemoteCommand(installedPath: string, args: string[]): Promise<string> {
  return commandRunner.runCommandCapture("git", args, {
    cwd: installedPath,
    env: {
      GIT_TERMINAL_PROMPT: "0",
    },
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
}

const gitRemote = { getLocalGitUpdateTarget, gitHasAvailableUpdate };

export default gitRemote;
