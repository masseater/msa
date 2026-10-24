const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);

const PR_MERGE = /\bgh\b[^\n;&|]*\bpr\s+merge\b/u;
const API_MERGE =
  /\bgh\b[^\n;&|]*\bapi\b[^\n;&|]*(?:\/pulls\/[^\s/]+\/merge\b|enablePullRequestAutoMerge|mergePullRequest|enqueuePullRequest)/u;

const REASON =
  "Workers and reviewers do not merge pull requests or turn on auto-merge: the harness squash-merges a task's pull request at the head the review passed. Leave the pull request pushed, current with its base, and green on CI, then end your turn.";

function refusal(toolName: string, args: unknown): string | undefined {
  if (!SHELL_TOOLS.has(toolName) || typeof args !== "object" || args === null) return undefined;
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string") return undefined;
  return PR_MERGE.test(command) || API_MERGE.test(command) ? REASON : undefined;
}

const mergeGuard = { REASON, refusal };

export default mergeGuard;
