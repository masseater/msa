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
  "number,url,title,body,state,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,statusCheckRollup";
const LIST_LIMIT = 20;
const CI_POLL_MS = 30_000;
const CI_WAIT_MS = 3 * 60 * 60_000;
const CI_APPEAR_MS = 2 * 60_000;

const noChecksSince = new WeakMap<runtimeTypes.Runtime, Map<string, number>>();

const GhPull = Schema.Struct({
  baseRefName: Schema.String,
  body: Schema.optionalKey(Schema.String),
  headRefName: Schema.String,
  headRefOid: Schema.String,
  mergeStateStatus: Schema.optionalKey(Schema.String),
  mergeable: Schema.optionalKey(Schema.String),
  number: Schema.Finite,
  state: Schema.String,
  statusCheckRollup: RollupEntry.pipe(Schema.Array, Schema.NullOr, Schema.optionalKey),
  title: Schema.optionalKey(Schema.String),
  url: Schema.String,
});

type PullView = typeof GhPull.Type;

const PullViewJson = Schema.fromJsonString(GhPull);
const PullListJson = GhPull.pipe(Schema.Array, Schema.fromJsonString);

type Task = orchestratorTypesTypes.Task;
type PullRequest = orchestratorTypesTypes.PullRequest;
type Verified = orchestratorTypesTypes.VerifiedPullRequest;

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
  if (checks.total === 0) return "none";
  if (checks.failed > 0) return "failing";
  if (checks.pending > 0) return "pending";
  return "passing";
}

function verifiedOf(pull: PullView): Verified {
  return { body: pull.body ?? "", sha: pull.headRefOid, title: pull.title ?? "" };
}

function recordOf(
  taskId: string,
  pull: PullView,
  verified: Verified | null,
  now: number,
): PullRequest {
  return {
    base: pull.baseRefName,
    branch: pull.headRefName,
    checkedAt: now,
    ci: ciOf(pull),
    harnessMerge: null,
    headSha: pull.headRefOid,
    mergeState: (pull.mergeStateStatus ?? "UNKNOWN").toUpperCase(),
    mergeable: (pull.mergeable ?? "UNKNOWN").toUpperCase(),
    number: pull.number,
    state: pull.state.toUpperCase(),
    taskId,
    url: pull.url,
    verified,
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
  verified: Verified,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  const subject = verified.title === "" ? `#${number}` : `${verified.title} (#${number})`;
  return Effect.asVoid(
    gh(
      runtime,
      [
        "pr",
        "merge",
        String(number),
        "--squash",
        "--match-head-commit",
        verified.sha,
        "--subject",
        subject,
        "--body",
        verified.body,
      ],
      cwd,
    ),
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

function heldByAnother(runtime: runtimeTypes.Runtime, taskId: string, branch: string): boolean {
  return store
    .listPullRequests(runtime.database, runtime.options.project)
    .some((pull) => pull.branch === branch && pull.taskId !== taskId);
}

function save(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  pull: PullView,
  verified: Verified | null,
  now: number,
): PullRequest {
  store.savePullRequest(runtime.database, recordOf(taskId, pull, verified, now));
  runtime.publish();
  return store.pullRequestOf(runtime.database, taskId) ?? recordOf(taskId, pull, verified, now);
}

function ciTiming(runtime: runtimeTypes.Runtime): { pollMs: number; waitMs: number } {
  return {
    pollMs: runtime.options.ciPollMs ?? CI_POLL_MS,
    waitMs: runtime.options.ciWaitMs ?? CI_WAIT_MS,
  };
}

function awaitingChecks(runtime: runtimeTypes.Runtime, record: PullRequest, now: number): boolean {
  if (record.state !== "OPEN" || record.ci !== "none") return false;
  const seen = noChecksSince.get(runtime) ?? new Map<string, number>();
  noChecksSince.set(runtime, seen);
  const key = `${record.number}@${record.headSha}`;
  const since = seen.get(key) ?? now;
  seen.set(key, since);
  return now - since < (runtime.options.ciAppearMs ?? CI_APPEAR_MS);
}

function refresh(runtime: runtimeTypes.Runtime, taskId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) return;
    const owner = yield* ownerOf(runtime, task);
    if (owner === undefined) return;
    if (heldByAnother(runtime, task.id, owner.branch)) return;
    const found = yield* Effect.result(current(runtime, owner));
    if (Result.isFailure(found) || found.success === undefined) return;
    const recorded = store.pullRequestOf(runtime.database, task.id);
    const verified = recorded?.number === found.success.number ? recorded.verified : null;
    save(runtime, task.id, found.success, verified, yield* nowMillis);
  });
}

const pullRequests = {
  awaitingChecks,
  ciTiming,
  current,
  merge,
  ownerOf,
  refresh,
  save,
  verifiedOf,
  view,
};

const pullRequestsModule = { pullRequests };

export default pullRequestsModule;
