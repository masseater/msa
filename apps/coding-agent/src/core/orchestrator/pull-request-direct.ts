import { Effect, Result } from "effect";

import pullRequestDirectSupport from "./pull-request-direct-support.ts";
import pullRequestDirectTask from "./pull-request-direct-task.ts";
import pullRequestOutside from "./pull-request-outside.ts";
import pullRequestProblems from "./pull-request-problems.ts";
import pullRequestRequest from "./pull-request-request.ts";
import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";

const { blockers, failWith, readView, refuse, whyNot } = pullRequestDirectSupport;
const { linkedTask, mergeTaskPull } = pullRequestDirectTask;
const { pullRequests } = pullRequestsModule;
const { judgeMerge } = pullRequestOutside;
const { short } = pullRequestProblems;
const { request } = pullRequestRequest;
const { nowMillis } = runtimeModule;

type OrchestratorError = runtimeTypes.OrchestratorError;
type PullView = Parameters<typeof pullRequestsModule.pullRequests.verifiedOf>[0];
type Verified = ReturnType<typeof pullRequestsModule.pullRequests.verifiedOf>;

interface Mark {
  commit: string | null;
  nonce: string | null;
}

function requestMerge(
  runtime: runtimeTypes.Runtime,
  number: number,
  verified: Verified,
  mark: Mark,
) {
  return request(runtime, runtime.options.cwd, number, verified, {
    accepted: (commit) => {
      mark.commit = commit;
    },
    refused: () => {
      mark.nonce = null;
    },
    requested: (nonce) => {
      mark.nonce = nonce;
    },
  });
}

function confirm(
  runtime: runtimeTypes.Runtime,
  after: PullView,
  verified: Verified,
  mark: Mark,
): Effect.Effect<{ ours: boolean; reason: string }> {
  return Effect.gen(function* () {
    const judged = yield* judgeMerge(
      runtime,
      runtime.options.cwd,
      {
        ...pullRequests.recordOf("", after, verified, yield* nowMillis),
        harnessCommit: mark.commit,
        harnessNonce: mark.nonce,
      },
      (commit) => {
        mark.commit = commit;
      },
    );
    if (judged === undefined) return { ours: false, reason: "it is not merged" };
    return judged.by === "harness"
      ? { ours: true, reason: "" }
      : { ours: false, reason: judged.reason };
  });
}

function mergeLoosePull(
  runtime: runtimeTypes.Runtime,
  number: number,
  head: string,
): Effect.Effect<string, OrchestratorError> {
  return Effect.gen(function* () {
    const pull = yield* readView(runtime, runtime.options.cwd, number);
    if (pull.state.toUpperCase() !== "OPEN") {
      return yield* refuse(number, `it is ${pull.state.toLowerCase()}.`);
    }
    const now = yield* nowMillis;
    const verified = { ...pullRequests.verifiedOf(pull), sha: head };
    const record = pullRequests.recordOf("", pull, null, now);
    const blocked = blockers(runtime, record, pull, verified, now);
    if (blocked.length > 0) return yield* refuse(number, blocked.join(" "));
    const mark: Mark = { commit: null, nonce: null };
    const { read, tried } = yield* requestMerge(runtime, number, verified, mark);
    const merged = `Squash-merged PR #${number} at head ${short(head)} as merge commit`;
    if (tried.kind === "merged") return `${merged} ${short(tried.commit)}.`;
    const after = read !== undefined && Result.isSuccess(read) ? read.success : undefined;
    if (after?.state.toUpperCase() !== "MERGED") {
      return yield* refuse(number, whyNot(tried, after?.state));
    }
    const { ours, reason } = yield* confirm(runtime, after, verified, mark);
    if (ours) return `${merged} ${short(mark.commit ?? "")}.`;
    return yield* failWith(
      `PR #${number} is merged as ${short(after.mergeCommit?.oid ?? "")}, but merge_pull_request cannot confirm the merge as its own: ${reason}. Its merge request ended with: ${tried.why}`,
    );
  });
}

function mergePullRequest(
  runtime: runtimeTypes.Runtime,
  number: number,
  head: string,
): Effect.Effect<string, OrchestratorError> {
  const linked = linkedTask(runtime, number);
  return linked === undefined
    ? mergeLoosePull(runtime, number, head)
    : mergeTaskPull(runtime, linked.task, linked.record, head);
}

const pullRequestDirect = { mergePullRequest };

export default pullRequestDirect;
