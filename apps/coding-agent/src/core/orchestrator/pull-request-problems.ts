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

function problemsOf(record: PullRequest, localHead: string | undefined): Problem[] {
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
  if (record.ci === "failing") {
    problems.push(
      fix(`CI fails on the head ${short(record.headSha)} of ${name}. Fix it and push.`),
    );
  } else if (record.ci === "pending") {
    problems.push({
      kind: "pending",
      text: `CI has not finished on the head ${short(record.headSha)} of ${name}.`,
    });
  }
  return problems;
}

const pullRequestProblems = { problemsOf, short };

export default pullRequestProblems;
