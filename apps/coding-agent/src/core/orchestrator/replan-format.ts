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
      "Open pull requests no task carries on (they stay with the closed task; hand each to a new task with replan from, or close it)",
      result.orphaned.map(
        (item) => `#${item.number} ${item.url} (${item.branch}) of ${item.taskId}`,
      ),
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
