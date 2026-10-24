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
  harness_merge_sha: string | null;
  checked_at: number;
}

function toPullRequest(row: PullRequestRow): PullRequest {
  return {
    base: row.base,
    branch: row.branch,
    checkedAt: row.checked_at,
    ci: row.ci as orchestratorTypesTypes.PullRequestCi,
    harnessMerge: row.harness_merge_sha,
    headSha: row.head_sha,
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

function savePullRequest(database: DatabaseSync, pullRequest: PullRequest): void {
  database
    .prepare(
      `INSERT INTO task_pull_requests (task_id, number, url, branch, base, state, head_sha, ci,
         mergeable, merge_state, verified_sha, verified_title, verified_body, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (task_id) DO UPDATE SET number = excluded.number, url = excluded.url,
         branch = excluded.branch, base = excluded.base, state = excluded.state,
         head_sha = excluded.head_sha, ci = excluded.ci, mergeable = excluded.mergeable,
         merge_state = excluded.merge_state, verified_sha = excluded.verified_sha,
         verified_title = excluded.verified_title, verified_body = excluded.verified_body,
         checked_at = excluded.checked_at,
         harness_merge_sha = CASE WHEN task_pull_requests.number = excluded.number
           THEN task_pull_requests.harness_merge_sha END`,
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
      pullRequest.checkedAt,
    );
}

function markHarnessMerge(database: DatabaseSync, taskId: string, sha: string): void {
  database
    .prepare("UPDATE task_pull_requests SET harness_merge_sha = ? WHERE task_id = ?")
    .run(sha, taskId);
}

function movePullRequest(database: DatabaseSync, from: string, to: string): void {
  database.prepare("DELETE FROM task_pull_requests WHERE task_id = ?").run(to);
  database.prepare("UPDATE task_pull_requests SET task_id = ? WHERE task_id = ?").run(to, from);
}

const pullRequestStore = {
  listPullRequests,
  markHarnessMerge,
  movePullRequest,
  pullRequestOf,
  savePullRequest,
};

export default pullRequestStore;
