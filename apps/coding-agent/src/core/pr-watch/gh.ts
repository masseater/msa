import { Effect } from "effect";

import errors from "../../utils/errors.ts";
import shell from "../../utils/shell.ts";
import execModule from "../exec.ts";
import type execTypes from "../exec.types.ts";
import ciHistory from "./ci-history.ts";
import type ghTypes from "./gh.types.ts";
import PrWatchGhError from "./pr-watch-gh-error.ts";
import snapshotModule from "./snapshot.ts";
import type snapshotTypes from "./snapshot.types.ts";

const { parsePrView } = snapshotModule;
const { runsFrom, workflowTimeout } = ciHistory;
const { execCommand } = execModule;
const { findExecutableOnPath } = shell;
const { toErrorMessage } = errors;

const PR_WATCH_FIELDS = [
  "state",
  "mergeable",
  "mergeStateStatus",
  "statusCheckRollup",
  "reviewDecision",
  "comments",
  "updatedAt",
  "baseRefName",
  "headRefOid",
] as const;
const GH_VIEW_TIMEOUT_MS = 30_000;
const RATE_LIMIT = /rate limit|too many requests|secondary rate/iu;
const AUTH = /not logged in|authentication|gh auth login|bad credentials|http 401|\b401\b/iu;
const NOT_FOUND = /could not resolve to a pullrequest|not found|http 404|\b404\b/iu;
function ghPrViewArgs(target: snapshotTypes.PrWatchTarget): string[] {
  const args = ["pr", "view", String(target.number)];
  if (target.repository !== undefined) args.push("--repo", target.repository);
  args.push("--json", PR_WATCH_FIELDS.join(","));
  return args;
}
function ghCompareArgs(
  target: snapshotTypes.PrWatchTarget,
  baseRefName: string,
  headRefOid: string,
): string[] {
  const repository = target.repository ?? "{owner}/{repo}";
  return [
    "api",
    `repos/${repository}/compare/${baseRefName}...${headRefOid}`,
    "--jq",
    ".behind_by",
  ];
}
function ghRunsArgs(target: snapshotTypes.PrWatchTarget): string[] {
  const repository = target.repository ?? "{owner}/{repo}";
  return [
    "api",
    `repos/${repository}/actions/runs?status=completed&exclude_pull_requests=true&per_page=100`,
    "--jq",
    "[.workflow_runs[] | {name, conclusion, created_at, run_started_at, updated_at}]",
  ];
}
function ghWorkflowFilesArgs(target: snapshotTypes.PrWatchTarget, headRefOid: string): string[] {
  const repository = target.repository ?? "{owner}/{repo}";
  return [
    "api",
    `repos/${repository}/contents/.github/workflows?ref=${headRefOid}`,
    "--jq",
    '.[] | select(.type == "file") | .path',
  ];
}
function ghWorkflowFileArgs(
  target: snapshotTypes.PrWatchTarget,
  path: string,
  headRefOid: string,
): string[] {
  const repository = target.repository ?? "{owner}/{repo}";
  return [
    "api",
    "-H",
    "Accept: application/vnd.github.raw+json",
    `repos/${repository}/contents/${path}?ref=${headRefOid}`,
  ];
}
function workflowPathsFrom(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\.ya?ml$/u.test(line));
}
function firstLine(text: string): string {
  const line = text.trim().split("\n", 1)[0]?.trim() ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
function classifyGhFailure(stdout: string, stderr: string): ghTypes.PrWatchFailure {
  const text = `${stderr}\n${stdout}`;
  if (RATE_LIMIT.test(text)) return "rate-limit";
  if (AUTH.test(text)) return "auth";
  if (NOT_FOUND.test(text)) return "not-found";
  return "other";
}
function ghErrorFrom(result: Pick<execTypes.ExecResult, "stdout" | "stderr">): PrWatchGhError {
  const kind = classifyGhFailure(result.stdout, result.stderr);
  const detail = firstLine(result.stderr) || firstLine(result.stdout);
  switch (kind) {
    case "rate-limit":
      return PrWatchGhError.make({
        kind,
        message: `gh hit the GitHub rate limit${detail === "" ? "" : `: ${detail}`}`,
      });
    case "auth":
      return PrWatchGhError.make({
        kind,
        message: `gh is not authenticated; run gh auth login${detail === "" ? "" : ` (${detail})`}`,
      });
    case "not-found":
      return PrWatchGhError.make({
        kind,
        message: `gh could not find this pull request${detail === "" ? "" : `: ${detail}`}`,
      });
    case "missing":
      return PrWatchGhError.make({ kind, message: "gh is not on PATH" });
    case "other":
      return PrWatchGhError.make({
        kind,
        message: `gh pr view failed${detail === "" ? "" : `: ${detail}`}`,
      });
  }
}
function readTimeouts(
  exec: (args: string[]) => Effect.Effect<execTypes.ExecResult, PrWatchGhError>,
  target: snapshotTypes.PrWatchTarget,
  headRefOid: string,
): ReturnType<ghTypes.PrWatchGh["timeouts"]> {
  return exec(ghWorkflowFilesArgs(target, headRefOid)).pipe(
    Effect.map((result) => workflowPathsFrom(result.stdout)),
    Effect.catchIf(
      (error) => error.kind === "not-found",
      () => Effect.succeed([]),
    ),
    Effect.flatMap((paths) =>
      Effect.forEach(paths, (path) =>
        exec(ghWorkflowFileArgs(target, path, headRefOid)).pipe(
          Effect.map((result) => workflowTimeout(path, result.stdout)),
        ),
      ),
    ),
    Effect.map((timeouts) => timeouts.filter((timeout) => timeout !== undefined)),
  );
}
function makeGh(options: ghTypes.PrWatchGhOptions): ghTypes.PrWatchGh {
  const find = options.find ?? findExecutableOnPath;
  const run =
    options.run ??
    ((args: string[]) => execCommand("gh", args, options.cwd, { timeout: GH_VIEW_TIMEOUT_MS }));

  const exec = (args: string[]): Effect.Effect<execTypes.ExecResult, PrWatchGhError> => {
    if (find("gh") === null) {
      return Effect.fail(PrWatchGhError.make({ kind: "missing", message: "gh is not on PATH" }));
    }
    return Effect.tryPromise({
      catch: (cause) => PrWatchGhError.make({ kind: "other", message: toErrorMessage(cause) }),
      try: () => run(args),
    }).pipe(
      Effect.filterOrFail(
        (result) => result.code === 0,
        (result) => ghErrorFrom(result),
      ),
    );
  };

  return {
    behind: (target, baseRefName, headRefOid) =>
      exec(ghCompareArgs(target, baseRefName, headRefOid)).pipe(
        Effect.flatMap((result) => {
          const behindBy = Number.parseInt(result.stdout.trim(), 10);
          if (Number.isFinite(behindBy)) return Effect.succeed(behindBy);
          return missingBehindByCount();
        }),
      ),
    runs: (target) => exec(ghRunsArgs(target)).pipe(Effect.flatMap(runsFrom)),
    timeouts: (target, headRefOid) => readTimeouts(exec, target, headRefOid),
    view: (target) =>
      exec(ghPrViewArgs(target)).pipe(
        Effect.flatMap((result) => {
          const snapshot = parsePrView(result.stdout);
          if (snapshot === undefined) {
            return Effect.fail(
              PrWatchGhError.make({
                kind: "other",
                message: "gh pr view printed JSON this version cannot read",
              }),
            );
          }
          return Effect.succeed(snapshot);
        }),
      ),
  };
}

const gh = {
  ghCompareArgs,
  ghPrViewArgs,
  ghRunsArgs,
  ghWorkflowFileArgs,
  ghWorkflowFilesArgs,
  makeGh,
};

export default gh;

function missingBehindByCount(): Effect.Effect<number, PrWatchGhError, never> {
  return Effect.fail(
    PrWatchGhError.make({
      kind: "other",
      message: "gh api compare printed no behind_by count",
    }),
  );
}
