import type goalCheckTextTypes from "./goal-check-text.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

type Problem = goalCheckTextTypes.Problem;
type PullRequest = orchestratorTypesTypes.PullRequest;

function short(sha: string): string {
  return sha.slice(0, 12);
}

function fix(text: string): Problem {
  return { kind: "fix", text };
}

function ciProblems(record: PullRequest, awaitingChecks: boolean): Problem[] {
  const name = `#${record.number}`;
  const head = short(record.headSha);
  if (record.ci === "failing")
    return [fix(`CI fails on the head ${head} of ${name}. Fix it and push.`)];
  if (record.ci === "pending") {
    return [{ kind: "pending", text: `CI has not finished on the head ${head} of ${name}.` }];
  }
  if (record.ci === "none" && awaitingChecks) {
    return [
      {
        kind: "pending",
        text: `No CI check has registered on the head ${head} of ${name} yet.`,
      },
    ];
  }
  return [];
}

function problemsOf(
  record: PullRequest,
  localHead: string | undefined,
  awaitingChecks: boolean,
): Problem[] {
  const name = `#${record.number}`;
  if (record.state === "MERGED") return [];
  if (record.state !== "OPEN") {
    return [
      fix(
        `Pull request ${name} is ${record.state.toLowerCase()}. Reopen it, or open a new pull request from ${record.branch} into ${record.base}.`,
      ),
    ];
  }
  const problems: Problem[] = [];
  if (localHead !== undefined && localHead !== record.headSha) {
    problems.push(
      fix(
        `The head of ${name} is ${short(record.headSha)}, but ${record.branch} in the worktree is at ${short(localHead)}. Push the branch so the pull request carries the work.`,
      ),
    );
  }
  if (record.mergeable === "CONFLICTING" || record.mergeState === "DIRTY") {
    problems.push(
      fix(
        `${name} conflicts with ${record.base}. Rebase ${record.branch} onto the latest ${record.base}, resolve the conflicts, and push.`,
      ),
    );
  } else if (record.mergeState === "BEHIND") {
    problems.push(
      fix(
        `${name} is behind ${record.base}. Rebase ${record.branch} onto the latest ${record.base} and push.`,
      ),
    );
  }
  return [...problems, ...ciProblems(record, awaitingChecks)];
}

const pullRequestProblems = { problemsOf, short };

export default pullRequestProblems;
