import promptsModule from "./prompts.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { notesBlock, stateBlock, truncateReport } = promptsModule.prompts;

function reportsBlock(reports: readonly orchestratorTypesTypes.Report[]): string {
  if (reports.length === 0) return "";
  return `<earlier-reports>\n${reports
    .map((report) => `[${report.role}/${report.status}]\n${truncateReport(report.content)}`)
    .join("\n\n")}\n</earlier-reports>`;
}

function advisorPrompt(
  task: orchestratorTypesTypes.TaskView,
  question: string,
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  const request = task.reports.findLast((report) => report.role !== "advisor");
  return [
    "You are an advisor to the orchestrator. The task below stopped because it needs a decision on how to proceed: its goal cannot be met as it stands, or the work is not moving. You did not do the work, and you do not decide.",
    "Read the task, the request, the reports, and the code. Weigh each option the request names, and any better one you find, against the goal: what it meets, what it gives up, what it would take, and what could go wrong. Then recommend one, and say what the orchestrator should tell the worker if it agrees. Do not edit files, commit, or push.",
    "",
    `<task id="${task.id}" title="${task.title}">`,
    stateBlock("current-state", task.currentState),
    stateBlock("goal-state", task.goalState),
    "</task>",
    `<decision-request>\n${request === undefined ? "(no report)" : truncateReport(request.content)}\n</decision-request>`,
    reportsBlock(task.reports.filter((report) => report !== request)),
    question === "" ? "" : `<question>\n${question}\n</question>`,
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n");
}

function resumePrompt(
  request: string,
  decision: string,
  notes: readonly orchestratorTypesTypes.Note[],
  from: "orchestrator" | "triage",
): string {
  const who =
    from === "triage"
      ? "A triage thread found that no human needs to decide this and decided it, with the grounds below"
      : "The orchestrator answered";
  return [
    "<decision-made>",
    `The task stopped for a decision on how to proceed. ${who}; continue the task from where it stopped, following the decision. The goal and the rules of your role still hold.`,
    `<decision-request>\n${truncateReport(request)}\n</decision-request>`,
    `<decision>\n${decision}\n</decision>`,
    "</decision-made>",
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function advisorWorkspaceBlock(workspace: orchestratorTypesTypes.Workspace): string {
  const from = workspace.branch === null ? "" : `, taken from ${workspace.branch}`;
  return [
    "<workspace>",
    `The harness checked out the task's work for you at ${workspace.cwd}: the worker's files as they are now, uncommitted changes included${from}. It is a copy of its own, not the worker's worktree, and your tools only read.`,
    ...(workspace.work === undefined
      ? []
      : [`<work-so-far against="${workspace.targetBranch}">`, workspace.work, "</work-so-far>"]),
    "</workspace>",
  ].join("\n");
}

const decisionPrompts = { advisorPrompt, advisorWorkspaceBlock, resumePrompt };

export default decisionPrompts;
