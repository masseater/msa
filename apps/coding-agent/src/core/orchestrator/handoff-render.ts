import platform from "../platform/index.ts";
import type handoffRenderTypes from "./handoff-render.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const REPORT_SUMMARY_LIMIT = 500;
const REPLAN_LIMIT = 5;

const HANDOFF_GUIDE = [
  "このファイルは msa の /handoff が書いた。",
  "読んだら、達成したい状態の順に create_task で依存を張って立て直す。",
];

const { formatLocalDateTime } = platform;

function quote(text: string, indent = ""): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `${indent}> ${line}`.trimEnd())
    .join("\n");
}

function summarize(text: string): string {
  const flat = text.trim();
  return flat.length <= REPORT_SUMMARY_LIMIT ? flat : `${flat.slice(0, REPORT_SUMMARY_LIMIT)}…`;
}

function items(
  title: string,
  list: readonly handoffRenderTypes.HandoffItem[] | undefined,
  tool: string,
): string {
  if (list === undefined) return `## ${title}\n\n（${tool} が使えないため取得していない）`;
  if (list.length === 0) return `## ${title}\n\nなし`;
  return [
    `## ${title}`,
    "",
    ...list.map((item) => `- #${item.number} ${item.title}${item.detail}`),
  ].join("\n");
}

function header(data: handoffRenderTypes.HandoffData): string {
  const { environment } = data;
  return [
    `# 引き継ぎ（${formatLocalDateTime(data.createdAt)}）`,
    "",
    `- msa: ${environment.version}`,
    `- リポジトリ: ${environment.repository ?? "-"}`,
    `- 枝: ${environment.branch ?? "-"}`,
    `- 作業ディレクトリ: ${environment.cwd}`,
  ].join("\n");
}

function modelSections(sections: handoffRenderTypes.HandoffSections): string {
  return [
    `## 前提\n\n${sections.premise.trim()}`,
    `## 達成したい状態（依存の順）\n\n${sections.goals.trim()}`,
    `## 着手してはいけないもの\n\n${sections.donts.trim()}`,
  ].join("\n\n");
}

function lastReport(task: orchestratorTypesTypes.TaskSnapshot): string[] {
  const report = task.reports.at(-1);
  if (report === undefined) return ["- 最後のレポート: なし"];
  return [
    `- 最後のレポート（${report.role}/${report.status}）:`,
    quote(summarize(report.content), "  "),
  ];
}

function taskBlock(task: orchestratorTypesTypes.TaskSnapshot): string {
  return [
    `### ${task.id} ${task.title}`,
    "",
    `- 状態: ${task.status}（${task.kind}、round ${task.round}）`,
    `- model: ${task.model ?? "既定"}`,
    `- 依存: ${task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "なし"}`,
    "- currentState:",
    quote(task.currentState, "  "),
    "- goalState:",
    quote(task.goalState, "  "),
    ...(task.checks.length === 0 ? [] : [`- checks: \`${JSON.stringify(task.checks)}\``]),
    ...lastReport(task),
  ].join("\n");
}

function byCreation(
  a: orchestratorTypesTypes.TaskSnapshot,
  b: orchestratorTypesTypes.TaskSnapshot,
): number {
  return (
    Number(a.kind === "review") - Number(b.kind === "review") ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

function tasksSection(tasks: readonly orchestratorTypesTypes.TaskSnapshot[]): string {
  if (tasks.length === 0) return "## タスク\n\nなし";
  return ["## タスク", "", tasks.toSorted(byCreation).map(taskBlock).join("\n\n")].join("\n");
}

function waitingSection(tasks: readonly orchestratorTypesTypes.TaskSnapshot[]): string {
  const waiting = tasks.filter((task) => task.status === "waiting");
  if (waiting.length === 0) return "## 待機中\n\nなし";
  return [
    "## 待機中",
    "",
    ...waiting.map(
      (task) => `- ${task.id} ${task.title}: ${task.waitingReason?.detail ?? "about to start"}`,
    ),
  ].join("\n");
}

function runningNotice(running: number): string {
  return `実行中 ${running} 本。止めるなら stop_task`;
}

function runningSection(tasks: readonly orchestratorTypesTypes.TaskSnapshot[]): string {
  const running = tasks.filter((task) => task.status === "running");
  if (running.length === 0) return "## 実行中\n\nなし";
  return [
    "## 実行中",
    "",
    runningNotice(running.length),
    "",
    ...running.map((task) => `- ${task.id} ${task.title}`),
  ].join("\n");
}

function noteAudience(note: orchestratorTypesTypes.Note): string {
  if (note.taskIds.length > 0) return `tasks ${note.taskIds.join(", ")}`;
  return note.round === null ? "all" : `round ${note.round}`;
}

function notesSection(notes: readonly orchestratorTypesTypes.Note[]): string {
  if (notes.length === 0) return "## 共有メモ\n\nなし";
  return [
    "## 共有メモ",
    "",
    notes
      .map(
        (note) =>
          `### ${note.id}（${formatLocalDateTime(note.createdAt)}、${note.author}、${noteAudience(note)}）\n\n${quote(note.content)}`,
      )
      .join("\n\n"),
  ].join("\n");
}

function replanBlock(replan: orchestratorTypesTypes.ReplanView): string {
  const titles = (label: string, list: readonly { title: string }[]) =>
    list.length > 0 ? [`- ${label}: ${list.map((item) => item.title).join(", ")}`] : [];
  return [
    `### ${replan.id}（${formatLocalDateTime(replan.createdAt)}）`,
    "",
    `- 理由: ${replan.reason}`,
    ...titles("止めた", replan.stopped),
    ...titles("作った", replan.created),
    ...titles("外した", replan.dropped),
  ].join("\n");
}

function replansSection(replans: readonly orchestratorTypesTypes.ReplanView[]): string {
  if (replans.length === 0) return "## 直近の replan\n\nなし";
  return [
    "## 直近の replan",
    "",
    replans.slice(0, REPLAN_LIMIT).map(replanBlock).join("\n\n"),
  ].join("\n");
}

function handoffMarker(createdAt: number, tasks: number): string {
  return `<!-- msa-handoff ${JSON.stringify({ createdAt, tasks })} -->`;
}

function renderHandoff(data: handoffRenderTypes.HandoffData): string {
  const { tasks } = data.snapshot;
  return [
    [...HANDOFF_GUIDE, handoffMarker(data.createdAt, tasks.length)].join("\n"),
    header(data),
    modelSections(data.sections),
    items("open の PR", data.environment.pulls, "gh"),
    items("open の issue", data.environment.issues, "gh"),
    tasksSection(tasks),
    waitingSection(tasks),
    runningSection(tasks),
    notesSection(data.notes),
    replansSection(data.snapshot.replans),
  ].join("\n\n");
}

const handoffRender = {
  HANDOFF_GUIDE,
  handoffMarker,
  renderHandoff,
  runningNotice,
};

export default handoffRender;
