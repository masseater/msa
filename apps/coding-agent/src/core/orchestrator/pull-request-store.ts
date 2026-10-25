import type DatabaseSync from "../platform/node/sqlite.ts";
import type orchestratorTypesTypes from "./types.types.ts";

type PullRequest = orchestratorTypesTypes.PullRequest;

interface PullRequestRow {
  task_id: string;
  number: number;
  url: string;
  branch: string;
  base: string;
  state: string;
  head_sha: string;
  ci: string;
  mergeable: string;
  merge_state: string;
  verified_sha: string | null;
  verified_title: string | null;
  verified_body: string | null;
  merge_commit: string | null;
  harness_merge_sha: string | null;
  blocked_head: string | null;
  harness_merge_commit: string | null;
  harness_merge_nonce: string | null;
  checked_at: number;
}

function toPullRequest(row: PullRequestRow): PullRequest {
  return {
    base: row.base,
    blockedHead: row.blocked_head,
    branch: row.branch,
    checkedAt: row.checked_at,
    ci: row.ci as orchestratorTypesTypes.PullRequestCi,
    harnessCommit: row.harness_merge_commit,
    harnessMerge: row.harness_merge_sha,
    harnessNonce: row.harness_merge_nonce,
    headSha: row.head_sha,
    mergeCommit: row.merge_commit,
    mergeState: row.merge_state,
    mergeable: row.mergeable,
    number: row.number,
    state: row.state,
    taskId: row.task_id,
    url: row.url,
    verified:
      row.verified_sha === null
        ? null
        : { body: row.verified_body ?? "", sha: row.verified_sha, title: row.verified_title ?? "" },
  };
}

function pullRequestOf(database: DatabaseSync, taskId: string): PullRequest | undefined {
  const row = database.prepare("SELECT * FROM task_pull_requests WHERE task_id = ?").get(taskId) as
    | PullRequestRow
    | undefined;
  return row === undefined ? undefined : toPullRequest(row);
}

function listPullRequests(database: DatabaseSync, project: string): PullRequest[] {
  const rows = database
    .prepare(
      `SELECT p.* FROM task_pull_requests p JOIN tasks t ON t.id = p.task_id WHERE t.project = ?`,
    )
    .all(project) as unknown as PullRequestRow[];
  return rows.map(toPullRequest);
}

function savePullRequest(
  database: DatabaseSync,
  pullRequest: PullRequest,
  keepHarnessMerge: boolean,
): void {
  database
    .prepare(
      `INSERT INTO task_pull_requests (task_id, number, url, branch, base, state, head_sha, ci,
         mergeable, merge_state, verified_sha, verified_title, verified_body, merge_commit,
         checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (task_id) DO UPDATE SET number = excluded.number, url = excluded.url,
         branch = excluded.branch, base = excluded.base, state = excluded.state,
         head_sha = excluded.head_sha, ci = excluded.ci, mergeable = excluded.mergeable,
         merge_state = excluded.merge_state, verified_sha = excluded.verified_sha,
         verified_title = excluded.verified_title, verified_body = excluded.verified_body,
         merge_commit = excluded.merge_commit, checked_at = excluded.checked_at,
         harness_merge_sha = CASE WHEN task_pull_requests.number = excluded.number
           AND (? OR excluded.state = 'MERGED') THEN task_pull_requests.harness_merge_sha END,
         harness_merge_nonce = CASE WHEN task_pull_requests.number = excluded.number
           AND (? OR excluded.state = 'MERGED') THEN task_pull_requests.harness_merge_nonce END,
         blocked_head = CASE WHEN task_pull_requests.number = excluded.number
           THEN task_pull_requests.blocked_head END,
         harness_merge_commit = CASE WHEN task_pull_requests.number = excluded.number
           THEN task_pull_requests.harness_merge_commit END`,
    )
    .run(
      pullRequest.taskId,
      pullRequest.number,
      pullRequest.url,
      pullRequest.branch,
      pullRequest.base,
      pullRequest.state,
      pullRequest.headSha,
      pullRequest.ci,
      pullRequest.mergeable,
      pullRequest.mergeState,
      pullRequest.verified?.sha ?? null,
      pullRequest.verified?.title ?? null,
      pullRequest.verified?.body ?? null,
      pullRequest.mergeCommit,
      pullRequest.checkedAt,
      keepHarnessMerge ? 1 : 0,
      keepHarnessMerge ? 1 : 0,
    );
}

function markHarnessMerge(
  database: DatabaseSync,
  taskId: string,
  merge: { sha: string; nonce: string } | null,
): void {
  database
    .prepare(
      `UPDATE task_pull_requests SET harness_merge_sha = ?, harness_merge_nonce = ?,
         harness_merge_commit = NULL WHERE task_id = ?`,
    )
    .run(merge?.sha ?? null, merge?.nonce ?? null, taskId);
}

function markBlockedHead(database: DatabaseSync, taskId: string, sha: string | null): void {
  database
    .prepare("UPDATE task_pull_requests SET blocked_head = ? WHERE task_id = ?")
    .run(sha, taskId);
}

function markHarnessCommit(database: DatabaseSync, taskId: string, commit: string): void {
  database
    .prepare("UPDATE task_pull_requests SET harness_merge_commit = ? WHERE task_id = ?")
    .run(commit, taskId);
}

function movePullRequest(database: DatabaseSync, from: string, to: string): void {
  database.prepare("DELETE FROM task_pull_requests WHERE task_id = ?").run(to);
  database.prepare("UPDATE task_pull_requests SET task_id = ? WHERE task_id = ?").run(to, from);
}

const pullRequestStore = {
  listPullRequests,
  markBlockedHead,
  markHarnessCommit,
  markHarnessMerge,
  movePullRequest,
  pullRequestOf,
  savePullRequest,
};

export default pullRequestStore;
