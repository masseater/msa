import type orchestratorTypesTypes from "./types.types.ts";

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

function segmentWords(text: string): string[] {
  const words: string[] = [];
  for (const segment of segmenter.segment(text.toLowerCase())) {
    if (segment.isWordLike === true) words.push(segment.segment);
  }
  return words;
}

function phrase(word: string): string {
  return `"${word.replaceAll('"', '""')}"`;
}

function searchQuery(text: string): string {
  const words = [...new Set(segmentWords(text))];
  return words.map(phrase).join(" OR ");
}

function firstLine(text: string | undefined): string {
  const line = (text ?? "").split("\n").find((candidate) => candidate.trim().length > 0);
  return line?.trim() ?? "";
}

function requireStates(
  label: string,
  currentState: string | undefined,
  goalState: string | undefined,
): { currentState: string; goalState: string } {
  if (currentState === undefined || currentState.trim() === "") {
    throw new Error(`${label} needs a current state`);
  }
  if (goalState === undefined || goalState.trim() === "") {
    throw new Error(`${label} needs a goal state`);
  }
  return { currentState, goalState };
}

function outputPattern(pattern: string): RegExp {
  return new RegExp(pattern, "mu");
}

function checkedPattern(label: string, command: string, pattern: string): string {
  try {
    outputPattern(pattern);
    return pattern;
  } catch (error) {
    throw new Error(
      `${label}: output of "${command}" is not a regular expression: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function requireChecks(
  label: string,
  inputs: readonly orchestratorTypesTypes.TaskCheckInput[] | undefined,
): orchestratorTypesTypes.TaskCheck[] {
  return (inputs ?? []).map((input) => {
    if (input.command.trim() === "") throw new Error(`${label} has a check without a command`);
    const exitCode = input.exitCode ?? 0;
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
      throw new Error(`${label}: exitCode of "${input.command}" must be an integer from 0 to 255`);
    }
    const output =
      input.output === undefined ? null : checkedPattern(label, input.command, input.output);
    return { command: input.command, exitCode, output };
  });
}

function requireMergeTarget(
  mergeInto: string | undefined,
  project: string,
  find: (id: string) => orchestratorTypesTypes.Task | undefined,
): string | null {
  if (mergeInto === undefined) return null;
  const target = find(mergeInto);
  if (target === undefined || target.project !== project) {
    throw new Error(`Unknown merge target: ${mergeInto}`);
  }
  if (target.kind !== "work") {
    throw new Error(`${mergeInto} is a review task; merge into a work task.`);
  }
  if (target.status !== "waiting") {
    throw new Error(
      `${mergeInto} is ${target.status}; merge only into a task that has not started, since it merges the branches when it starts.`,
    );
  }
  if (!target.opensPullRequest) {
    throw new Error(
      `${mergeInto} opens no pull request (opensPullRequest false), so no branch can merge into it; merge into a task that opens one.`,
    );
  }
  return target.id;
}

function requirePullRequestChoice(
  label: string,
  opensPullRequest: boolean | undefined,
  mergeInto: string | undefined,
): boolean {
  if (opensPullRequest === false && mergeInto !== undefined) {
    throw new Error(
      `${label}: opensPullRequest false and mergeInto ${mergeInto} contradict each other; a task that merges into another adds commits to that task's pull request. Drop mergeInto for a task that changes no code, or opensPullRequest for one that does.`,
    );
  }
  return opensPullRequest ?? true;
}

function pullRequestText(pull: orchestratorTypesTypes.PullRequest): string {
  return `PR #${pull.number} ${pull.state.toLowerCase()}, head ${pull.headSha.slice(0, 12)}, CI ${pull.ci}, mergeable ${pull.mergeable.toLowerCase()} (${pull.mergeState.toLowerCase()})`;
}

const text = {
  firstLine,
  outputPattern,
  phrase,
  pullRequestText,
  requireChecks,
  requireMergeTarget,
  requirePullRequestChoice,
  requireStates,
  searchQuery,
  segmentWords,
};

export default text;
