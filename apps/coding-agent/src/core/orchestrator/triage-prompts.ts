import decisionPrompts from "./decision-prompts.ts";
import goalItemsModule from "./goal-items.ts";
import promptsModule from "./prompts.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { goalItems } = goalItemsModule;
const { notesBlock, stateBlock, truncateReport } = promptsModule.prompts;

const RELATED_LIMIT = 1500;

type TaskView = orchestratorTypesTypes.TaskView;

function clip(text: string): string {
  return text.length <= RELATED_LIMIT ? text : `${text.slice(0, RELATED_LIMIT)}\n[…]`;
}

function relatedBlock(related: readonly TaskView[]): string {
  const latest = related.flatMap((task) => {
    const report = task.reports.at(-1);
    return report === undefined
      ? []
      : [
          `<task id="${task.id}" title="${task.title}" status="${task.status}">\n[${report.role}/${report.status}]\n${clip(report.content)}\n</task>`,
        ];
  });
  return latest.length === 0 ? "" : `<related-tasks>\n${latest.join("\n")}\n</related-tasks>`;
}

function earlierBlock(task: TaskView): string {
  if (task.reports.length === 0) return "";
  return `<task-reports>\n${task.reports
    .map((report) => `[${report.role}/${report.status}]\n${clip(report.content)}`)
    .join("\n\n")}\n</task-reports>`;
}

function triagePrompt(
  task: TaskView,
  request: string,
  related: readonly TaskView[],
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  return [
    "You are the triage for a task whose work stopped for a decision on how to proceed: the thread that stopped said the goal cannot be met as written, or the harness found the work not moving. Before the orchestrator or the user sees it, decide whether a human really has to decide.",
    "Look widely before you conclude: the goal and each of its items, the request, the work so far, the pull request, the repository and its AGENTS.md files, and the past decisions in the commit log, the issues, and the reports below. Look for a way that meets every constraint at once; the thread that stopped may have missed one, or a past decision may already answer it.",
    "Conclude with conclude_triage, once. decided: no human is needed; give the way to proceed, its grounds (which constraint each part meets and how, and which past decision it follows), and how it meets each goal item. The thread that stopped continues with it from where it stopped. needs-human: only the user can decide, because the way forward involves billing, personal data, revoking an existing key or token, or a choice of specification nobody has made yet, and neither the goal, the code, nor any past decision answers it; say which, and why the past decisions do not answer it.",
    "Narrowing the goal, relaxing a rule, or leaving something as a known limitation, out of scope, or for later is a compromise, not a way to proceed; when it is the only way you see, say so in conclude_triage, and the decision goes to the orchestrator. A request that repeats one an earlier triage of this task already decided needs a human. You cannot edit files, commit, or push; your tools only read.",
    "",
    `<task id="${task.id}" title="${task.title}">`,
    stateBlock("current-state", task.currentState),
    stateBlock("goal-state", task.goalState),
    "</task>",
    "<goal-items>",
    ...goalItems(task.goalState).map((item, index) => `${index + 1}. ${item}`),
    "</goal-items>",
    `<decision-request>\n${truncateReport(request)}\n</decision-request>`,
    earlierBlock(task),
    relatedBlock(related),
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n");
}

function triageWorkspaceBlock(workspace: orchestratorTypesTypes.Workspace): string {
  return [
    decisionPrompts.advisorWorkspaceBlock(workspace),
    ...(workspace.history === undefined ? [] : [`<history>\n${workspace.history}\n</history>`]),
  ].join("\n");
}

const triagePrompts = { triagePrompt, triageWorkspaceBlock };

export default triagePrompts;
