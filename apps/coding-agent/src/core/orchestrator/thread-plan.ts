import decisionPrompts from "./decision-prompts.ts";
import ids from "./ids.ts";
import promptsModule from "./prompts.ts";
import type runtimeTypes from "./runtime.types.ts";
import snapshot from "./snapshot.ts";
import storeModule from "./store.ts";
import type threadPlanTypes from "./thread-plan.types.ts";
import triagePrompts from "./triage-prompts.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { snapshots } = snapshot;
const { prompts } = promptsModule;
const { newId } = ids;

type ThreadPlan = threadPlanTypes.ThreadPlan;

function notesFor(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  threadId: string,
): orchestratorTypesTypes.Note[] {
  return store.unreadNotes(runtime.database, runtime.options.project, taskId, threadId);
}

function markRead(
  runtime: runtimeTypes.Runtime,
  notes: readonly orchestratorTypesTypes.Note[],
  threadId: string,
  now: number,
): void {
  for (const note of notes) store.markNoteRead(runtime.database, note.id, threadId, now);
}

function viewsById(runtime: runtimeTypes.Runtime): Map<string, orchestratorTypesTypes.TaskView> {
  return new Map(
    snapshots
      .taskViews(runtime.database, runtime.options.project)
      .map((view) => [view.id, view] as const),
  );
}

function reviewerPrompt(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.TaskView,
  workerReport: string,
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  if (task.kind === "review") {
    const byId = viewsById(runtime);
    const roundTasks = store
      .workTasksOfRound(runtime.database, runtime.options.project, task.round)
      .flatMap((work) => byId.get(work.id) ?? []);
    return prompts.roundReviewPrompt(task.round, roundTasks, notes);
  }
  return prompts.taskReviewerPrompt(task, workerReport, notes);
}

function relatedTo(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.TaskView,
  byId: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): orchestratorTypesTypes.TaskView[] {
  const related = new Set([
    ...task.dependsOn,
    ...task.dependents,
    ...store
      .workTasksOfRound(runtime.database, runtime.options.project, task.round)
      .map((work) => work.id),
  ]);
  related.delete(task.id);
  return [...related].flatMap((id) => byId.get(id) ?? []);
}

function promptFor(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.TaskView,
  role: orchestratorTypesTypes.ThreadRole,
  workerReport: string,
  notes: readonly orchestratorTypesTypes.Note[],
  extra: string,
): string {
  if (role === "advisor") return decisionPrompts.advisorPrompt(task, extra, notes);
  const byId = viewsById(runtime);
  if (role === "triage")
    return triagePrompts.triagePrompt(task, extra, relatedTo(runtime, task, byId), notes);
  const base =
    role === "reviewer"
      ? reviewerPrompt(runtime, task, workerReport, notes)
      : prompts.workerPrompt(
          task,
          task.dependsOn.flatMap((id) => byId.get(id) ?? []),
          notes,
        );
  return [base, extra].filter(Boolean).join("\n\n");
}

function planThread(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  workerReport: string,
  extra: string,
): ThreadPlan {
  const threadId = newId("th");
  const view = viewsById(runtime).get(task.id);
  if (view === undefined) throw new Error(`Unknown task: ${task.id}`);
  const notes = notesFor(runtime, task.id, threadId);
  const prompt = promptFor(runtime, view, role, workerReport, notes, extra);
  return { ...threadModel(runtime, task, role), notes, prompt, threadId };
}

function threadModel(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
): Pick<ThreadPlan, "model" | "thinkingLevel"> {
  const defaults = runtime.options.defaults();
  return role === "worker"
    ? {
        model: task.model ?? defaults.workerModel,
        thinkingLevel: task.thinkingLevel ?? defaults.workerThinkingLevel,
      }
    : { model: defaults.reviewModel, thinkingLevel: defaults.reviewThinkingLevel };
}

const threadPlans = { markRead, notesFor, planThread, threadModel };

const threadPlan = { threadPlans };

export default threadPlan;
