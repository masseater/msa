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
  return target.id;
}

const text = {
  firstLine,
  outputPattern,
  phrase,
  requireChecks,
  requireMergeTarget,
  requireStates,
  searchQuery,
  segmentWords,
};

export default text;
