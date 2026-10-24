import html from "../../utils/html.ts";
import textModule from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { pullRequestText } = textModule;
const { escapeXml } = html;

const REPORT_LIMIT = 6000;

const STYLE_CRITERIA =
  "Judge the work against every rule in the <development_style> section of your system prompt as well as against the goal. Work that breaks one of those rules is not acceptable; name the rule and where it is broken.";

function verdictCriteria(goal: string): string[] {
  return [
    `The work is not acceptable while any finding within ${goal} remains, whatever its severity. Do not pass the work with such a finding by calling it minor, saying it need not block the merge, or leaving it for a separate issue: it is fixed in the same pull request and reviewed again.`,
    `Report under separate headings: the findings within ${goal}, the problems outside it that could become separate issues, and what you checked. Problems outside ${goal} do not make the work unacceptable. Say clearly whether the work is acceptable.`,
  ];
}

function truncateReport(text: string): string {
  return text.length <= REPORT_LIMIT ? text : `${text.slice(0, REPORT_LIMIT)}\n[truncated]`;
}

function notesBlock(notes: readonly orchestratorTypesTypes.Note[]): string {
  if (notes.length === 0) return "";
  return [
    "<shared-notes>",
    "Messages sent to this work while it was waiting or between turns. Follow them.",
    ...notes.map(
      (note) => `<note id="${note.id}" from="${note.author}">\n${note.content}\n</note>`,
    ),
    "</shared-notes>",
  ].join("\n");
}

function dependencyBlock(dependencies: readonly orchestratorTypesTypes.TaskView[]): string {
  if (dependencies.length === 0) return "";
  return [
    "<dependency-reports>",
    ...dependencies.map((dependency) => {
      const report = latestReport(dependency);
      return `<task id="${dependency.id}" title="${dependency.title}" status="${dependency.status}">\n${report === undefined ? "(no report)" : truncateReport(report.content)}\n</task>`;
    }),
    "</dependency-reports>",
  ].join("\n");
}

function latestReport(
  task: orchestratorTypesTypes.TaskView,
): orchestratorTypesTypes.Report | undefined {
  return task.reports.at(-1);
}

function stateBlock(tag: string, value: string): string {
  return `<${tag}>\n${value}\n</${tag}>`;
}

function checkExpectation(check: orchestratorTypesTypes.TaskCheck): string {
  const exit = `exit ${check.exitCode}`;
  return check.output === null ? exit : `${exit}, output matching /${check.output}/m`;
}

function checkLines(checks: readonly orchestratorTypesTypes.TaskCheck[]): string[] {
  return checks.map((check) => `- \`${check.command}\` → ${checkExpectation(check)}`);
}

function checksBlock(checks: readonly orchestratorTypesTypes.TaskCheck[]): string {
  if (checks.length === 0) return "";
  return [
    "<goal-checks>",
    "When you end your turn, the harness runs these commands in the working directory. The task is done only when every one gives the expected result; otherwise the results come back to you.",
    ...checkLines(checks),
    "</goal-checks>",
  ].join("\n");
}

function workspaceBlock(
  role: orchestratorTypesTypes.ThreadRole,
  workspace: orchestratorTypesTypes.Workspace,
): string {
  if (workspace.branch === null) return "";
  const where = `The harness created this task's git worktree at ${workspace.cwd}, on branch ${workspace.branch}.`;
  if (role === "reviewer") {
    return [
      "<workspace>",
      `${where} The work to review is the diff of ${workspace.branch} against ${workspace.targetBranch}.`,
      "</workspace>",
    ].join("\n");
  }
  const target =
    workspace.target === null
      ? `When the work is done, push ${workspace.branch}, open a pull request into ${workspace.targetBranch}, and end your turn once CI passes on its head. The harness finds the pull request from ${workspace.branch}, sends the work back while the pull request is missing, unpushed, behind, conflicting, or not green, and squash-merges it after the review passes; do not merge it or turn on auto-merge.`
      : `This work merges into task ${workspace.target.id} "${workspace.target.title}" on branch ${workspace.targetBranch}, which opens the pull request. Commit and push ${workspace.branch}; do not open a pull request.`;
  const sources =
    workspace.sources.length === 0
      ? []
      : [
          `These tasks merge into this one. Merge their branches into ${workspace.branch} before you open the pull request:`,
          ...workspace.sources.map(
            (source) => `- ${source.branch} (task ${source.task.id} "${source.task.title}")`,
          ),
        ];
  return [
    "<workspace>",
    `${where} Work and commit here; do not create another worktree or switch this one to another branch.`,
    target,
    ...sources,
    "</workspace>",
  ].join("\n");
}

function reviewFindingsBlock(task: orchestratorTypesTypes.TaskView): string {
  const judged = task.reports.findLast(
    (report) => report.role === "reviewer" && report.verdict !== null,
  );
  if (judged?.verdict !== "fail") return "";
  return [
    "<review-failed>",
    "A reviewer checked this task's work and found problems within its goal, so the task is not complete. Fix every finding within the goal in the same branch and pull request, whatever its severity; a new review follows when you end your turn.",
    `<review-report>\n${truncateReport(judged.content)}\n</review-report>`,
    "</review-failed>",
  ].join("\n");
}

function workerPrompt(
  task: orchestratorTypesTypes.TaskView,
  dependencies: readonly orchestratorTypesTypes.TaskView[],
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  return [
    stateBlock("current-state", task.currentState),
    stateBlock("goal-state", task.goalState),
    checksBlock(task.checks),
    reviewFindingsBlock(task),
    dependencyBlock(dependencies),
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function pullRequestBlock(task: orchestratorTypesTypes.TaskView): string {
  const pull = task.pullRequest;
  if (pull?.verified === null || pull?.verified === undefined) return "";
  return [
    `<pull-request number="${pull.number}" head="${pull.verified.sha}" url="${escapeXml(pull.url)}">`,
    `<title>${escapeXml(pull.verified.title)}</title>`,
    `<body>\n${escapeXml(pull.verified.body)}\n</body>`,
    "</pull-request>",
    `The harness squash-merges this pull request at this head after you pass it, with this title and body as the commit message. Check that the body describes the final diff of ${pull.branch} against ${pull.base}: what it changes, why, and how it was verified, with nothing from earlier attempts that the diff no longer does. A body that does not match the diff is a finding within the goal.`,
  ].join("\n");
}

function taskReviewerPrompt(
  task: orchestratorTypesTypes.TaskView,
  workerReport: string,
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  const work = [
    `<task id="${task.id}" title="${task.title}">`,
    stateBlock("current-state", task.currentState),
    stateBlock("goal-state", task.goalState),
    "</task>",
    `<worker-report>\n${truncateReport(workerReport)}\n</worker-report>`,
    pullRequestBlock(task),
  ]
    .filter(Boolean)
    .join("\n");
  return [
    "You are reviewing work another thread just did. You did not write it.",
    "Read the report, inspect the changed files and the surrounding code, and check the work against the task. Do not redo it and do not edit files.",
    STYLE_CRITERIA,
    ...verdictCriteria("the task's goal"),
    "",
    work,
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n");
}

function roundReviewPrompt(
  round: string,
  tasks: readonly orchestratorTypesTypes.TaskView[],
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  const reports = tasks
    .map(
      (task) =>
        `<task id="${task.id}" title="${task.title}" status="${task.status}">\n${task.reports
          .map((report) => `[${report.role}/${report.status}]\n${truncateReport(report.content)}`)
          .join("\n\n")}\n</task>`,
    )
    .join("\n\n");
  return [
    `You are the closing reviewer of round "${round}" of an orchestrated project. Every task of the round has finished, and nothing of the round runs while you work.`,
    "Step back and review the work as a whole, not task by task: check the results against each other and against the original intent, read the code they changed, and find gaps, conflicts, duplicated work, and wrong assumptions.",
    STYLE_CRITERIA,
    ...verdictCriteria("the goals of the round's tasks"),
    "Then redesign: say what should change in the overall approach and lay out the remaining work as tasks with their dependencies, so the orchestrator can start the next round. A finding within a task's goal becomes work on that task's pull request, not a new issue. If nothing is left, say so.",
    "",
    "<round-tasks>",
    reports,
    "</round-tasks>",
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n");
}

function taskHeading(task: orchestratorTypesTypes.Task): string {
  return `${task.id} [${task.kind}, ${task.status}, round ${task.round}] ${task.title}`;
}

function formatTaskList(tasks: readonly orchestratorTypesTypes.TaskView[]): string {
  if (tasks.length === 0) return "No tasks.";
  return tasks.map(describeTask).join("\n");
}

function assignmentText(task: orchestratorTypesTypes.TaskView): string {
  const threads = task.assignments.map((assignment) => `${assignment.role} ${assignment.threadId}`);
  return threads.length > 0 ? threads.join(", ") : "unassigned";
}

function describeTask(task: orchestratorTypesTypes.TaskView): string {
  const dependencies = task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "-";
  const condition = task.condition === null ? "" : ` condition "${task.condition}"`;
  const pull = task.pullRequest === null ? "" : `; ${pullRequestText(task.pullRequest)}`;
  return `${taskHeading(task)} — depends on ${dependencies}; ${assignmentText(task)}${condition}${pull}`;
}

function formatTaskDetail(
  task: orchestratorTypesTypes.TaskView,
  threads: readonly string[],
): string {
  const reports = task.reports.map(
    (report) =>
      `<report role="${report.role}" status="${report.status}">\n${report.content}\n</report>`,
  );
  return [
    describeTask(task),
    `Dependents: ${task.dependents.join(", ") || "-"}`,
    threads.length > 0 ? `Threads: ${threads.join(", ")}` : "Threads: -",
    task.pullRequest === null
      ? "Pull request: -"
      : `Pull request: ${task.pullRequest.url} (${task.pullRequest.branch} into ${task.pullRequest.base}, ${pullRequestText(task.pullRequest)}, head ${task.pullRequest.headSha})`,
    stateBlock("current-state", task.currentState),
    stateBlock("goal-state", task.goalState),
    ...(task.checks.length === 0 ? [] : [`Checks:\n${checkLines(task.checks).join("\n")}`]),
    ...reports,
  ].join("\n\n");
}

const prompts = {
  checkExpectation,
  checksBlock,
  dependencyBlock,
  formatTaskDetail,
  formatTaskList,
  latestReport,
  notesBlock,
  roundReviewPrompt,
  stateBlock,
  taskHeading,
  taskReviewerPrompt,
  workerPrompt,
  workspaceBlock,
};

const promptsModule = {
  prompts,
};

export default promptsModule;
