import { Data, Effect } from "effect";

import { toErrorMessage } from "../../utils/errors.ts";
import { findExecutableOnPath } from "../../utils/shell.ts";
import { type ExecResult, execCommand } from "../exec.ts";
import { parsePrView, type PrSnapshot, type PrWatchTarget } from "./snapshot.ts";

export type PrWatchFailure = "missing" | "auth" | "not-found" | "rate-limit" | "other";

export class PrWatchGhError extends Data.TaggedError("PrWatchGhError")<{
  readonly kind: PrWatchFailure;
  readonly message: string;
}> {}

export type PrWatchGh = (target: PrWatchTarget) => Effect.Effect<PrSnapshot, PrWatchGhError>;

const PR_WATCH_FIELDS = [
  "state",
  "mergeable",
  "mergeStateStatus",
  "statusCheckRollup",
  "reviewDecision",
  "comments",
  "updatedAt",
] as const;

const GH_VIEW_TIMEOUT_MS = 30_000;

const RATE_LIMIT = /rate limit|too many requests|secondary rate/iu;
const AUTH = /not logged in|authentication|gh auth login|bad credentials|http 401|\b401\b/iu;
const NOT_FOUND = /could not resolve to a pullrequest|not found|http 404|\b404\b/iu;

export function ghPrViewArgs(target: PrWatchTarget): string[] {
  const args = ["pr", "view", String(target.number)];
  if (target.repository !== undefined) args.push("--repo", target.repository);
  args.push("--json", PR_WATCH_FIELDS.join(","));
  return args;
}

function firstLine(text: string): string {
  const line = text.trim().split("\n", 1)[0]?.trim() ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

function classifyGhFailure(stdout: string, stderr: string): PrWatchFailure {
  const text = `${stderr}\n${stdout}`;
  if (RATE_LIMIT.test(text)) return "rate-limit";
  if (AUTH.test(text)) return "auth";
  if (NOT_FOUND.test(text)) return "not-found";
  return "other";
}

function ghErrorFrom(result: Pick<ExecResult, "stdout" | "stderr">): PrWatchGhError {
  const kind = classifyGhFailure(result.stdout, result.stderr);
  const detail = firstLine(result.stderr) || firstLine(result.stdout);
  switch (kind) {
    case "rate-limit":
      return new PrWatchGhError({
        kind,
        message: `gh hit the GitHub rate limit${detail ? `: ${detail}` : ""}`,
      });
    case "auth":
      return new PrWatchGhError({
        kind,
        message: `gh is not authenticated; run gh auth login${detail ? ` (${detail})` : ""}`,
      });
    case "not-found":
      return new PrWatchGhError({
        kind,
        message: `gh could not find this pull request${detail ? `: ${detail}` : ""}`,
      });
    case "missing":
      return new PrWatchGhError({ kind, message: "gh is not on PATH" });
    case "other":
      return new PrWatchGhError({
        kind,
        message: `gh pr view failed${detail ? `: ${detail}` : ""}`,
      });
  }
}

export interface PrWatchGhOptions {
  readonly cwd: string;
  readonly find?: (executable: string) => string | null;
  readonly run?: (args: string[]) => Promise<ExecResult>;
}

export function makeGh(options: PrWatchGhOptions): PrWatchGh {
  const find = options.find ?? findExecutableOnPath;
  const run =
    options.run ??
    ((args: string[]) => execCommand("gh", args, options.cwd, { timeout: GH_VIEW_TIMEOUT_MS }));

  return (target) => {
    if (find("gh") === null) {
      return Effect.fail(new PrWatchGhError({ kind: "missing", message: "gh is not on PATH" }));
    }
    return Effect.tryPromise({
      try: () => run(ghPrViewArgs(target)),
      catch: (cause) => new PrWatchGhError({ kind: "other", message: toErrorMessage(cause) }),
    }).pipe(
      Effect.flatMap((result) => {
        if (result.code !== 0) return Effect.fail(ghErrorFrom(result));
        const snapshot = parsePrView(result.stdout);
        if (snapshot === undefined) {
          return Effect.fail(
            new PrWatchGhError({
              kind: "other",
              message: "gh pr view printed JSON this version cannot read",
            }),
          );
        }
        return Effect.succeed(snapshot);
      }),
    );
  };
}
