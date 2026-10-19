import { ModelThinkingLevelSchema } from "@msa/ai/providers/model-schema";
import { Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { prompts } from "./prompts.ts";
import {
  dependsSchema,
  instructionSchema,
  modelChangeSchema,
  modelSchema,
  prioritySchema,
  taskIdObject,
  taskIdSchema,
  tool,
} from "./tool-support.ts";

const createSchema = Type.Object({
  title: Type.String({ description: "Short name of the work." }),
  prompt: Type.String({
    description: "The full task. The session sees nothing of this conversation but this prompt.",
  }),
  dependsOn: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Tasks that must complete before this one starts; their reports join the prompt. Pass [] only when the work needs none.",
    }),
  ),
  round: Type.Optional(
    Type.String({
      description:
        "Partial DAG (round) this task belongs to. Unrelated work belongs to a different round, so each round's closing review waits only for its own tasks. Default: the round of the dependencies, or main.",
    }),
  ),
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Files or directories the task changes. Tasks with overlapping paths never run at the same time and are batched into one session.",
    }),
  ),
  repos: Type.Optional(
    Type.Array(Type.String(), {
      description: "Repositories the task changes, when no narrower paths are known.",
    }),
  ),
  condition: Type.Optional(
    Type.String({
      description:
        "Shell command that must exit 0 before the task starts, for external waits such as a merged PR or a green CI.",
    }),
  ),
  priority: Type.Optional(
    Type.Integer({ description: "Higher runs first among waiting tasks. Default: 0." }),
  ),
  model: Type.Optional(modelSchema),
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  cwd: Type.Optional(Type.String({ description: "Working directory. Default: this session's." })),
});

export function taskToolsA(orchestrator: Orchestrator): Record<string, ToolDefinition> {
  return {
    create_task: tool({
      name: "create_task",
      label: "create task",
      description:
        "Create a task: one piece of work, with the tasks it depends on and the paths it touches. The scheduler starts it when its dependencies finish, batches tasks that touch the same paths into one session, and assigns a separate reviewer session after the worker. Each round's tasks end in a closing review task.",
      promptSnippet: "Create a task with its dependencies, paths, and round",
      promptGuidelines: [
        "Answer simple questions yourself; put new work into tasks with create_task, one task per independent piece.",
        "Always declare dependsOn and the paths the task changes. Tasks with overlapping paths are serialized and batched; unrelated work belongs to a different round.",
        "The scheduler owns assignment and start; do not start sessions yourself.",
        "When a closing review reports, act on it: create the next round's tasks, or tell the user the work is done.",
      ],
      parameters: createSchema,
      run: (params) =>
        orchestrator.createTask(params).then((task) => prompts.formatTaskList([task])),
    }),
    list_tasks: tool({
      name: "list_tasks",
      label: "list tasks",
      description:
        "List tasks with status, round, dependencies, assignments, paths, and conditions.",
      promptSnippet: "List the task DAG",
      parameters: Type.Object({}),
      run: () => orchestrator.list().then(prompts.formatTaskList),
    }),
    read_task: tool({
      name: "read_task",
      label: "read task",
      description: "Read a task's prompt, reports, dependencies, dependents, and sessions.",
      promptSnippet: "Read a task's full state and reports",
      parameters: taskIdObject,
      run: ({ taskId }) =>
        orchestrator.read(taskId).then((task) =>
          prompts.formatTaskDetail(
            task,
            task.assignments.map((assignment) => `${assignment.sessionId} (${assignment.role})`),
          ),
        ),
    }),
  };
}

export function taskToolsB(orchestrator: Orchestrator): Record<string, ToolDefinition> {
  return {
    set_task_depends: tool({
      name: "set_task_depends",
      label: "set task dependencies",
      description:
        "Add and drop the tasks one or more tasks wait for. A task that has not started changes freely; a running task only gains a dependency that already finished, because waiting for anything else means stopping it first. Cycles are rejected.",
      promptSnippet: "Change what tasks wait for",
      promptGuidelines: [
        "Dependencies and instructions can change after creation: while a task has not started, set_task_depends and set_task_instruction rewrite them in place. Stop a running task before changing what it waits for or what it was told to do.",
      ],
      parameters: dependsSchema,
      run: (params) =>
        orchestrator
          .setDepends(params)
          .then((tasks) =>
            tasks
              .map((task) => `${task.id} depends on ${task.dependsOn.join(", ") || "-"}.`)
              .join("\n"),
          ),
    }),
    set_task_instruction: tool({
      name: "set_task_instruction",
      label: "set task instruction",
      description:
        "Replace what a task that has not started is told to do. The session reads the new instruction when the scheduler starts it. A running task is rejected: stop it first, or steer it with send_message.",
      promptSnippet: "Rewrite the instruction of a task that has not started",
      parameters: instructionSchema,
      run: ({ taskId, prompt }) =>
        orchestrator
          .setInstruction(taskId, prompt)
          .then((task) => `${task.id} ${task.title} now starts with:\n\n${task.prompt}`),
    }),
    set_task_priority: tool({
      name: "set_task_priority",
      label: "set task priority",
      description:
        "Change the priority of a waiting task; the scheduler runs higher priorities first.",
      promptSnippet: "Change a task's priority",
      parameters: prioritySchema,
      run: ({ taskId, priority }) =>
        orchestrator.setPriority(taskId, priority).then((task) => `Priority: ${task.priority}.`),
    }),
    set_task_model: tool({
      name: "set_task_model",
      label: "set task model",
      description:
        "Change the model and thinking level of a task, including one that is running. It applies to the task's next session and to the running one.",
      promptSnippet: "Change a task's model",
      parameters: modelChangeSchema,
      run: ({ taskId, model, thinkingLevel }) =>
        orchestrator
          .setModel(taskId, model, thinkingLevel)
          .then((task) => `${task.id} now uses ${task.model} (thinking ${task.thinkingLevel}).`),
    }),
  };
}
