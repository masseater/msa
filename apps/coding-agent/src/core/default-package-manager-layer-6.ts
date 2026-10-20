import * as Effect from "effect/Effect";

import childProcess from "../utils/child-process.ts";
import awaitingModule from "./awaiting.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import DefaultPackageManagerLayer5 from "./default-package-manager-layer-5.ts";
import platformModule from "./platform.ts";
import type nodeChildProcessTypes from "./platform/node/child-process.types.ts";
import type nodeStreamTypes from "./platform/node/stream.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { spawnProcess } = childProcess;
const { schedule } = platformModule;
const { NETWORK_TIMEOUT_MS, getEnv, isOfflineModeEnabled } = defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer6 extends DefaultPackageManagerLayer5 {
  protected gitHasAvailableUpdate(installedPath: string): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (isOfflineModeEnabled()) {
          return false;
        }

        try {
          const localHead = yield* awaited(
            this.runCommandCapture("git", ["rev-parse", "HEAD"], {
              cwd: installedPath,
              timeoutMs: NETWORK_TIMEOUT_MS,
            }),
          );
          const remoteHead = yield* performed(this.getRemoteGitHead(installedPath));
          return localHead.trim() !== remoteHead.trim();
        } catch {
          return false;
        }
      }, this),
    );
  }

  protected getRemoteGitHead(installedPath: string): Effect.Effect<string> {
    return awaitingWith(function* () {
      const upstreamRef = yield* performed(this.getGitUpstreamRef(installedPath));
      if (upstreamRef !== undefined && upstreamRef !== "") {
        const remoteHead = yield* awaited(
          this.runGitRemoteCommand(installedPath, ["ls-remote", "origin", upstreamRef]),
        );
        const match = remoteHead.match(/^([0-9a-f]{40})\s+/mu);
        if (match?.[1] !== undefined && match?.[1] !== "") {
          return match[1];
        }
      }

      const remoteHead = yield* awaited(
        this.runGitRemoteCommand(installedPath, ["ls-remote", "origin", "HEAD"]),
      );
      const match = remoteHead.match(/^([0-9a-f]{40})\s+HEAD$/mu);
      if (match?.[1] === undefined || match?.[1] === "") {
        throw new Error("Failed to determine remote HEAD");
      }
      return match[1];
    }, this);
  }

  protected getLocalGitUpdateTarget(
    installedPath: string,
  ): Promise<{ ref: string; head: string; fetchArgs: string[] }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          const upstream = yield* awaited(
            this.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
              cwd: installedPath,
              timeoutMs: NETWORK_TIMEOUT_MS,
            }),
          );
          const trimmedUpstream = upstream.trim();
          if (!trimmedUpstream.startsWith("origin/")) {
            throw new Error(`Unsupported upstream remote: ${trimmedUpstream}`);
          }
          const branch = trimmedUpstream.slice("origin/".length);
          if (branch === "") {
            throw new Error("Missing upstream branch name");
          }
          const head = yield* awaited(
            this.runCommandCapture("git", ["rev-parse", "@{upstream}"], {
              cwd: installedPath,
              timeoutMs: NETWORK_TIMEOUT_MS,
            }),
          );
          return {
            fetchArgs: [
              "fetch",
              "--prune",
              "--no-tags",
              "origin",
              `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
            ],
            head,
            ref: "@{upstream}",
          };
        } catch {
          yield* awaited(
            this.runCommand("git", ["remote", "set-head", "origin", "-a"], {
              cwd: installedPath,
            }).catch(() => {}),
          );
          const head = yield* awaited(
            this.runCommandCapture("git", ["rev-parse", "origin/HEAD"], {
              cwd: installedPath,
              timeoutMs: NETWORK_TIMEOUT_MS,
            }),
          );
          const originHeadRef = yield* awaited(
            this.runCommandCapture("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
              cwd: installedPath,
              timeoutMs: NETWORK_TIMEOUT_MS,
            }).catch(() => ""),
          );
          const branch = originHeadRef.trim().replace(/^refs\/remotes\/origin\//u, "");
          if (branch !== "") {
            return {
              fetchArgs: [
                "fetch",
                "--prune",
                "--no-tags",
                "origin",
                `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
              ],
              head,
              ref: "origin/HEAD",
            };
          }
          return {
            fetchArgs: [
              "fetch",
              "--prune",
              "--no-tags",
              "origin",
              "+HEAD:refs/remotes/origin/HEAD",
            ],
            head,
            ref: "origin/HEAD",
          };
        }
      }, this),
    );
  }

  protected getGitUpstreamRef(installedPath: string): Effect.Effect<string | undefined> {
    return awaitingWith(function* () {
      try {
        const upstream = yield* awaited(
          this.runCommandCapture("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
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
    }, this);
  }

  protected runGitRemoteCommand(installedPath: string, args: string[]): Promise<string> {
    return this.runCommandCapture("git", args, {
      cwd: installedPath,
      env: {
        GIT_TERMINAL_PROMPT: "0",
      },
      timeoutMs: NETWORK_TIMEOUT_MS,
    });
  }

  protected spawnCaptureCommand(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): nodeChildProcessTypes.ChildProcessByStdio<
    null,
    nodeStreamTypes.Readable,
    nodeStreamTypes.Readable
  > {
    const baseEnv = getEnv();
    const env = options?.env === undefined ? baseEnv : { ...baseEnv, ...options.env };
    return spawnProcess(command, args, {
      cwd: options?.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  protected runCommandCapture(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<string> {
    return Effect.runPromise(
      Effect.callback<string>((resume) => {
        const child = this.spawnCaptureCommand(command, args, options);
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timeout =
          typeof options?.timeoutMs === "number"
            ? schedule(() => {
                timedOut = true;
                child.kill();
              }, options.timeoutMs)
            : undefined;

        child.stdout?.on("data", (data) => {
          stdout += data.toString();
        });
        child.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        child.once("error", (error) => {
          if (timeout !== undefined) timeout.cancel();
          resume(Effect.die(error));
        });
        child.once("close", (code, signal) => {
          if (timeout !== undefined) timeout.cancel();
          if (timedOut) {
            resume(
              Effect.die(
                new Error(`${command} ${args.join(" ")} timed out after ${options?.timeoutMs}ms`),
              ),
            );
            return;
          }
          if (code === 0) {
            resume(Effect.succeed(stdout.trim()));
            return;
          }
          const exitStatus = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
          resume(
            Effect.die(
              new Error(
                `${command} ${args.join(" ")} failed with ${exitStatus}: ${stderr || stdout}`,
              ),
            ),
          );
        });
      }),
    );
  }
}
