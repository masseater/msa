import modelSchemaModule from "@msa/ai/providers/model-schema";
import { Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { prompts } from "./prompts.ts";
import { modelSchema, taskIdSchema, tool } from "./tool-support.ts";

const { ModelThinkingLevelSchema } = modelSchemaModule;

const replanTaskSchema = Type.Object({
  currentState: Type.Optional(
    Type.String({
      description:
        "What is true now, including what the tasks it replaces finished and the handoff memo says. Default: the current states of those tasks.",
    }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory." })),
  dependsOn: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Task ids or keys of other entries. Default: the dependencies of the tasks it replaces.",
    }),
  ),
  from: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Existing tasks this one replaces: one to rewrite or split off, several to merge. Their states and handoff memos come along, and they are closed.",
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
  model: Type.Optional(modelSchema),
  round: Type.Optional(
    Type.String({ description: "Round id. Default: the round of the task it replaces, or main." }),
  ),
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  title: Type.String({ description: "Short name of the work." }),
});

const replanSchema = Type.Object({
  drop: Type.Optional(
    Type.Array(Type.Object({ taskId: taskIdSchema, reason: Type.String() }), {
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
    Type.Integer({ minimum: 1, description: "Threads that may run at the same time." }),
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
        taskId: taskIdSchema,
        dependsOn: Type.Array(Type.String(), { description: "Task ids or keys." }),
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

export function replanTools(orchestrator: Orchestrator): Record<string, ToolDefinition> {
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
        "A task you replace keeps its round, dependencies, and states unless you say otherwise.",
        "Write each new task as a currentState and a goalState, never as a procedure. Use the handoff memo to say what is true now.",
      ],
      promptSnippet: "Stop the work, rewrite the task DAG, and resume it",
      run: (params) => orchestrator.replan(params).then(prompts.formatReplan),
    }),
  };
}
