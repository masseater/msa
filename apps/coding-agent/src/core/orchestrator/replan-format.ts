import type orchestratorTypesTypes from "./types.types.ts";

type ReplanResult = orchestratorTypesTypes.ReplanResult;

function memoFirstLine(memo: string): string {
  const line = memo.split("\n").find((candidate) => candidate.trim() !== "");
  return line?.trim() ?? "(no memo)";
}

function section(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : [`${title}:\n${items.map((item) => `- ${item}`).join("\n")}`];
}

function taskLines(result: ReplanResult): string[] {
  return [
    ...section(
      "Stopped",
      result.stopped.map((item) => `${item.taskId} ${item.title}: ${memoFirstLine(item.memo)}`),
    ),
    ...section(
      "Dropped",
      result.dropped.map((item) => `${item.taskId} ${item.title}: ${item.reason}`),
    ),
    ...section(
      "Created",
      result.created.map(
        (item) =>
          `${item.taskId} ${item.title}${item.from.length > 0 ? ` from ${item.from.join(", ")}` : ""}`,
      ),
    ),
    ...(result.kept.length > 0 ? [`Kept: ${result.kept.join(", ")}.`] : []),
  ];
}

function pullRequestLines(result: ReplanResult): string[] {
  return [
    ...(result.handedOver.length > 0
      ? [
          `Pull requests handed over: ${result.handedOver
            .map((item) => `#${item.number} from ${item.from} to ${item.to}`)
            .join("; ")}.`,
        ]
      : []),
    ...section(
      "Open pull requests no task carries on (they stay with the closed task, which no later replan can name in from, so no task takes them over; close each one, and a task that continues its work opens its own pull request from its own branch)",
      result.orphaned.map(
        (item) => `#${item.number} ${item.url} (${item.branch}) of ${item.taskId}`,
      ),
    ),
    ...section(
      "Closed tasks that ran outside a git working tree (they had no branch, so the harness tracked no pull request of theirs and hands none over; close any pull request one of them opened, and a task that continues its work opens its own pull request from its own branch)",
      result.untracked.map((item) => `${item.taskId} in ${item.cwd}`),
    ),
    ...section(
      "Pull requests of closed tasks that GitHub did not answer for (the harness could not tell whether one is open, so it handed none over; look at the branch, close an open pull request there, and a task that continues its work opens its own pull request from its own branch)",
      result.unread.map((item) => `${item.taskId} on ${item.branch}: ${item.error}`),
    ),
  ];
}

function formatReplan(result: ReplanResult): string {
  if (result.aborted !== null) {
    return `Replan aborted: ${result.aborted}. No task was created, dropped, or rewired.`;
  }
  return [
    `Replanned ${result.replanId}.`,
    ...taskLines(result),
    ...pullRequestLines(result),
    ...(result.rewired.length > 0
      ? [
          `Rewired: ${result.rewired
            .map((item) => `${item.taskId} depends on ${item.dependsOn.join(", ") || "-"}`)
            .join("; ")}.`,
        ]
      : []),
    result.started.length > 0 ? `Started: ${result.started.join(", ")}.` : "Nothing started.",
  ].join("\n");
}

const replanFormat = { formatReplan };

export default replanFormat;
