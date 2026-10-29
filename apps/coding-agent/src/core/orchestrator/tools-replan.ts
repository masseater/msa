import modelSchemaModule from "@msa/ai/providers/model-schema";
import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type orchestratorTypes from "./orchestrator.types.ts";
import replanFormat from "./replan-format.ts";
import toolSupport from "./tool-support.ts";

const { checksSchema, modelSchema, taskIdSchema, tool } = toolSupport;

const { ModelThinkingLevelSchema } = modelSchemaModule;

const replanTaskSchema = Type.Object({
  checks: Type.Optional(checksSchema),
  currentState: Type.Optional(
    Type.String({
      description:
        "What is true now, including what the tasks it replaces finished and the handoff memo says. Default: the current states of those tasks.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory: a checkout of the repository when the task has checks. Default: the cwd of the first task it replaces, or this session's.",
    }),
  ),
  dependsOn: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Task ids or keys of other entries. Default: the dependencies of the tasks it replaces.",
    }),
  ),
  from: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Existing tasks this one replaces: one to rewrite or split off, several to merge. Their states and handoff memos come along, and they are closed. The open pull request whose head is the branch of a task it replaces becomes this task's own when this task has no mergeInto and no pull request yet: it continues on that branch, and the harness reviews and merges that pull request. A task that ran outside a git working tree has no branch, so nothing of it is handed over; the result names it, and a pull request it opened is closed and opened again from the new task's branch.",
    }),
  ),
  goalState: Type.Optional(
    Type.String({
      description:
        "What should be true when it is done. Default: the goal states of the tasks it replaces.",
    }),
  ),
  key: Type.Optional(
    Type.String({
      description: "Short name other entries of this replan use in dependsOn.",
    }),
  ),
  mergeInto: Type.Optional(
    Type.String({
      description:
        "Existing work task that has not started and whose branch this task's branch merges into; the harness makes it depend on this task. Default: the merge target of the first task it replaces. Tasks that merged into a replaced task merge into the first task that replaces it.",
    }),
  ),
  model: Type.Optional(modelSchema),
  round: Type.Optional(
    Type.String({ description: "Round id. Default: the round of the task it replaces, or main." }),
  ),
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  title: Type.String({ description: "Short name of the work." }),
});

const replanSchema = Type.Object({
  drop: Type.Optional(
    Type.Array(Type.Object({ reason: Type.String(), taskId: taskIdSchema }), {
      description: "Tasks closed without a successor.",
    }),
  ),
  keep: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Existing tasks left in place. A stopped one resumes with its handoff memo. Every running task must be kept, replaced, or dropped.",
    }),
  ),
  maxConcurrentThreads: Type.Optional(
    Type.Integer({ description: "Threads that may run at the same time.", minimum: 1 }),
  ),
  reason: Type.String({
    description: "Why the plan changes. Shown in the tasks view and on every task this closes.",
  }),
  resume: Type.Optional(
    Type.Boolean({
      description: "Default true: start the replanned tasks once the plan is written.",
    }),
  ),
  rewire: Type.Optional(
    Type.Array(
      Type.Object({
        dependsOn: Type.Array(Type.String(), { description: "Task ids or keys." }),
        taskId: taskIdSchema,
      }),
      { description: "Replaces the dependencies of a kept task." },
    ),
  ),
  stop: Type.Optional(
    Type.Boolean({
      description:
        "Default true: every running thread commits and pushes, writes a handoff memo, then stops before the plan changes. false only rewires waiting work.",
    }),
  ),
  tasks: Type.Optional(Type.Array(replanTaskSchema, { description: "The new plan." })),
});

function replanTools(
  orchestrator: orchestratorTypes.Orchestrator,
): Record<string, extensionsTypesTypes.ToolDefinition> {
  return {
    replan: tool({
      description:
        "Stop the work at a turn boundary, collect each task's state, rewrite the task DAG, and start the new plan in one call. Running threads commit and push, then write a handoff memo; the memo reaches whatever continues the work as reference, not as steps. Replacing a task with several splits it, replacing several with one merges them, dropping closes it with a reason. Cycles are rejected and nothing changes when a wrap-up fails.",
      label: "replan",
      name: "replan",
      parameters: replanSchema,
      promptGuidelines: [
        "Use replan when the plan itself is wrong, not to nudge one task: send_message and send_note steer work that stays as it is.",
        "Every running task must be kept, replaced by a task with from, or dropped. The call is rejected otherwise.",
        "Use replan to insert a task that must run before existing ones: add it and rewire the tasks it precedes to depend on it. Keep the dependencies strict; prefer chaining work on the same area, branch, or precondition over running it in parallel.",
        "A task you replace keeps its round, dependencies, states, and checks unless you say otherwise. Pass checks to replace them; [] removes them.",
        "Write each new task as a currentState and a goalState, never as a procedure. Use the handoff memo to say what is true now.",
      ],
      promptSnippet: "Stop the work, rewrite the task DAG, and resume it",
      run: (params) => orchestrator.replan(params).then(replanFormat.formatReplan),
    }),
  };
}

const toolsReplan = {
  replanTools,
};

export default toolsReplan;
