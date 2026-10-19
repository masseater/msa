import { ModelThinkingLevelSchema } from "@msa/ai/providers/model-schema";
import { Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { prompts } from "./prompts.ts";
import { modelSchema, taskIdSchema, tool } from "./tool-support.ts";

const replanTaskSchema = Type.Object({
  key: Type.Optional(
    Type.String({
      description: "Short name other entries of this replan use in dependsOn.",
    }),
  ),
  from: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Existing tasks this one replaces: one to rewrite or split off, several to merge. Their handoff memos and prompts come along, and they are closed.",
    }),
  ),
  title: Type.String({ description: "Short name of the work." }),
  prompt: Type.Optional(
    Type.String({
      description:
        "The remaining scope. Default: the prompt of the tasks it replaces. The handoff memo joins it in the session's prompt.",
    }),
  ),
  dependsOn: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Task ids or keys of other entries. Default: the dependencies of the tasks it replaces.",
    }),
  ),
  round: Type.Optional(
    Type.String({ description: "Round id. Default: the round of the task it replaces, or main." }),
  ),
  paths: Type.Optional(
    Type.Array(Type.String(), { description: "Files or directories it changes." }),
  ),
  repos: Type.Optional(Type.Array(Type.String(), { description: "Repositories it changes." })),
  priority: Type.Optional(Type.Integer({ description: "Higher runs first. Default: 0." })),
  model: Type.Optional(modelSchema),
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  cwd: Type.Optional(Type.String({ description: "Working directory." })),
});

const replanSchema = Type.Object({
  reason: Type.String({
    description: "Why the plan changes. Shown in the tasks view and on every task this closes.",
  }),
  tasks: Type.Optional(Type.Array(replanTaskSchema, { description: "The new plan." })),
  keep: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Existing tasks left in place. A stopped one resumes with its handoff memo. Every running task must be kept, replaced, or dropped.",
    }),
  ),
  drop: Type.Optional(
    Type.Array(Type.Object({ taskId: taskIdSchema, reason: Type.String() }), {
      description: "Tasks closed without a successor.",
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
  maxConcurrentSessions: Type.Optional(
    Type.Integer({ minimum: 1, description: "Sessions that may run at the same time." }),
  ),
  stop: Type.Optional(
    Type.Boolean({
      description:
        "Default true: every running session commits and pushes, writes a handoff memo, then stops before the plan changes. false only rewires waiting work.",
    }),
  ),
  resume: Type.Optional(
    Type.Boolean({
      description: "Default true: start the replanned tasks once the plan is written.",
    }),
  ),
});

export function replanTools(orchestrator: Orchestrator): Record<string, ToolDefinition> {
  return {
    replan: tool({
      name: "replan",
      label: "replan",
      description:
        "Stop the work at a turn boundary, collect each task's state, rewrite the task DAG, and start the new plan in one call. Running sessions commit and push, then write a handoff memo; the memo joins the prompt of whatever continues the work. Replacing a task with several splits it, replacing several with one merges them, dropping closes it with a reason. Cycles are rejected and nothing changes when a wrap-up fails.",
      promptSnippet: "Stop the work, rewrite the task DAG, and resume it",
      promptGuidelines: [
        "Use replan when the plan itself is wrong, not to nudge one task: send_message and send_note steer work that stays as it is.",
        "Every running task must be kept, replaced by a task with from, or dropped. The call is rejected otherwise.",
        "A task you replace keeps its round and dependencies unless you say otherwise.",
      ],
      parameters: replanSchema,
      run: (params) => orchestrator.replan(params).then(prompts.formatReplan),
    }),
  };
}
