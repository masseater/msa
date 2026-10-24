import { Effect, Result } from "effect";
import * as Schema from "effect/Schema";

import prWatchSnapshot from "../pr-watch/snapshot.ts";
import errors from "./errors.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { orchestratorError } = errors;
const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { worktrees } = worktreeModule;
const { RollupEntry, countChecks } = prWatchSnapshot;

const FIELDS =
  "number,url,state,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,statusCheckRollup";
const LIST_LIMIT = 20;

const GhPull = Schema.Struct({
  baseRefName: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  mergeStateStatus: Schema.optionalKey(Schema.String),
  mergeable: Schema.optionalKey(Schema.String),
  number: Schema.Finite,
  state: Schema.String,
  statusCheckRollup: RollupEntry.pipe(Schema.Array, Schema.NullOr, Schema.optionalKey),
  url: Schema.String,
});

type PullView = typeof GhPull.Type;

const PullViewJson = Schema.fromJsonString(GhPull);
const PullListJson = GhPull.pipe(Schema.Array, Schema.fromJsonString);

type Task = orchestratorTypesTypes.Task;
type PullRequest = orchestratorTypesTypes.PullRequest;

interface Owner {
  branch: string;
  base: string;
  cwd: string;
}

function gh(
  runtime: runtimeTypes.Runtime,
  args: readonly string[],
  cwd: string,
): Effect.Effect<string, runtimeTypes.OrchestratorError> {
  return Effect.tryPromise({
    catch: orchestratorError,
    try: () => runtime.options.runGh(args, cwd),
  }).pipe(
    Effect.flatMap((result) =>
      result.code === 0
        ? Effect.succeed(result.stdout)
        : Effect.fail(
            orchestratorError(
              new Error(
                `gh ${args.slice(0, 2).join(" ")}: ${(result.stderr || result.stdout).trim()}`,
              ),
            ),
          ),
    ),
  );
}

function decoded<A>(
  schema: Schema.Codec<A, string>,
  json: string,
  what: string,
): Effect.Effect<A, runtimeTypes.OrchestratorError> {
  return Effect.fromOption(Schema.decodeOption(schema)(json)).pipe(
    Effect.mapError(() =>
      orchestratorError(new Error(`gh ${what} printed JSON this msa cannot read`)),
    ),
  );
}

function ciOf(pull: PullView): orchestratorTypesTypes.PullRequestCi {
  const checks = countChecks(pull.statusCheckRollup ?? []);
  if (checks.failed > 0) return "failing";
  if (checks.pending > 0 || checks.total === 0) return "pending";
  return "passing";
}

function recordOf(
  taskId: string,
  pull: PullView,
  verifiedSha: string | null,
  now: number,
): PullRequest {
  return {
    base: pull.baseRefName,
    branch: pull.headRefName,
    checkedAt: now,
    ci: ciOf(pull),
    headSha: pull.headRefOid,
    mergeState: (pull.mergeStateStatus ?? "UNKNOWN").toUpperCase(),
    mergeable: (pull.mergeable ?? "UNKNOWN").toUpperCase(),
    number: pull.number,
    state: pull.state.toUpperCase(),
    taskId,
    url: pull.url,
    verifiedSha,
  };
}

function findByBranch(
  runtime: runtimeTypes.Runtime,
  cwd: string,
  branch: string,
): Effect.Effect<PullView | undefined, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const json = yield* gh(
      runtime,
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "all",
        "--limit",
        String(LIST_LIMIT),
        "--json",
        FIELDS,
      ],
      cwd,
    );
    const pulls = yield* decoded(PullListJson, json, "pr list");
    const open = pulls.find((pull) => pull.state.toUpperCase() === "OPEN");
    return open ?? pulls.toSorted((left, right) => right.number - left.number)[0];
  });
}

function view(
  runtime: runtimeTypes.Runtime,
  cwd: string,
  number: number,
): Effect.Effect<PullView, runtimeTypes.OrchestratorError> {
  return Effect.flatMap(
    gh(runtime, ["pr", "view", String(number), "--json", FIELDS], cwd),
    (json) => decoded(PullViewJson, json, "pr view"),
  );
}

function merge(
  runtime: runtimeTypes.Runtime,
  cwd: string,
  number: number,
  sha: string,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.asVoid(
    gh(runtime, ["pr", "merge", String(number), "--squash", "--match-head-commit", sha], cwd),
  );
}

function latestThreadOf(
  runtime: runtimeTypes.Runtime,
  taskId: string,
): orchestratorTypesTypes.Thread | undefined {
  return store
    .assignmentsOfTask(runtime.database, taskId)
    .flatMap((assignment) => store.getThread(runtime.database, assignment.threadId) ?? [])
    .filter((thread) => thread.branch !== null)
    .toSorted((left, right) => left.createdAt - right.createdAt)
    .at(-1);
}

function ownerOf(runtime: runtimeTypes.Runtime, task: Task): Effect.Effect<Owner | undefined> {
  return Effect.gen(function* () {
    if (task.kind !== "work" || task.mergeInto !== null) return undefined;
    const thread = latestThreadOf(runtime, task.id);
    if (thread?.branch === null || thread?.branch === undefined) return undefined;
    if (!(yield* worktrees.hasOrigin(thread.cwd))) return undefined;
    return { base: thread.targetBranch ?? "", branch: thread.branch, cwd: thread.cwd };
  });
}

function current(
  runtime: runtimeTypes.Runtime,
  owner: Owner,
): Effect.Effect<PullView | undefined, runtimeTypes.OrchestratorError> {
  return findByBranch(runtime, owner.cwd, owner.branch);
}

function save(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  pull: PullView,
  verifiedSha: string | null,
  now: number,
): PullRequest {
  const record = recordOf(taskId, pull, verifiedSha, now);
  store.savePullRequest(runtime.database, record);
  runtime.publish();
  return record;
}

function refresh(runtime: runtimeTypes.Runtime, taskId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) return;
    const owner = yield* ownerOf(runtime, task);
    if (owner === undefined) return;
    const holder = store
      .listPullRequests(runtime.database, runtime.options.project)
      .find((pull) => pull.branch === owner.branch && pull.taskId !== task.id);
    if (holder !== undefined) return;
    const found = yield* Effect.result(current(runtime, owner));
    if (Result.isFailure(found) || found.success === undefined) return;
    const recorded = store.pullRequestOf(runtime.database, task.id);
    const verified = recorded?.number === found.success.number ? recorded.verifiedSha : null;
    save(runtime, task.id, found.success, verified, yield* nowMillis);
  });
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

function problemsOf(record: PullRequest, localHead: string | undefined): string[] {
  const name = `#${record.number}`;
  if (record.state === "MERGED") return [];
  if (record.state !== "OPEN") {
    return [
      `Pull request ${name} is ${record.state.toLowerCase()}. Reopen it, or open a new pull request from ${record.branch} into ${record.base}.`,
    ];
  }
  const problems: string[] = [];
  if (localHead !== undefined && localHead !== record.headSha) {
    problems.push(
      `The head of ${name} is ${short(record.headSha)}, but ${record.branch} in the worktree is at ${short(localHead)}. Push the branch so the pull request carries the work.`,
    );
  }
  if (record.mergeable === "CONFLICTING" || record.mergeState === "DIRTY") {
    problems.push(
      `${name} conflicts with ${record.base}. Rebase ${record.branch} onto the latest ${record.base}, resolve the conflicts, and push.`,
    );
  } else if (record.mergeState === "BEHIND") {
    problems.push(
      `${name} is behind ${record.base}. Rebase ${record.branch} onto the latest ${record.base} and push.`,
    );
  }
  if (record.ci === "failing") {
    problems.push(`CI fails on the head ${short(record.headSha)} of ${name}. Fix it and push.`);
  } else if (record.ci === "pending") {
    problems.push(
      `CI has not finished on the head ${short(record.headSha)} of ${name}. Wait until every check passes (pr_watch reports it) before ending your turn.`,
    );
  }
  return problems;
}

const pullRequests = {
  current,
  merge,
  ownerOf,
  problemsOf,
  refresh,
  save,
  short,
  view,
};

const pullRequestsModule = { pullRequests };

export default pullRequestsModule;
