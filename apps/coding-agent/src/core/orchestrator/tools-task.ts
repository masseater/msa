import modelSchemaModule from "@msa/ai/providers/model-schema";
import { Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { prompts } from "./prompts.ts";
import {
  dependsSchema,
  modelChangeSchema,
  modelSchema,
  stateSchema,
  taskIdObject,
  taskIdSchema,
  tool,
} from "./tool-support.ts";

const { ModelThinkingLevelSchema } = modelSchemaModule;

const createSchema = Type.Object({
  condition: Type.Optional(
    Type.String({
      description:
        "Shell command that must exit 0 before the task starts, for external waits such as a merged PR or a green CI.",
    }),
  ),
  currentState: Type.String({
    description:
      "What is true now: the code as it stands, the failing check, what already exists. Facts, not steps.",
  }),
  cwd: Type.Optional(Type.String({ description: "Working directory. Default: this session's." })),
  dependsOn: Type.Optional(
    Type.Array(taskIdSchema, {
      description:
        "Tasks that must complete before this one starts; their reports join the prompt. Pass [] only when the work needs none.",
    }),
  ),
  goalState: Type.String({
    description: "What should be true when the task is done, in terms that can be checked.",
  }),
  model: Type.Optional(modelSchema),
  round: Type.Optional(
    Type.String({
      description:
        "Partial DAG (round) this task belongs to. Unrelated work belongs to a different round, so each round's closing review waits only for its own tasks. Default: the round of the dependencies, or main.",
    }),
  ),
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  title: Type.String({ description: "Short name of the work." }),
});

export function taskToolsA(orchestrator: Orchestrator): Record<string, ToolDefinition> {
  return {
    create_task: tool({
      description:
        "Create a task from the state it starts in and the state it must reach. Write those two states, not a procedure: a list of steps breaks as soon as the starting state is not what you assumed. The scheduler starts the task when its dependencies finish and assigns a separate reviewer thread after the worker. Each round's tasks end in a closing review task.",
      label: "create task",
      name: "create_task",
      parameters: createSchema,
      promptGuidelines: [
        "Answer simple questions yourself; put new work into tasks with create_task, one task per independent piece.",
        "Write currentState and goalState only. Never list steps; say what holds now and what must hold at the end.",
        "The scheduler owns assignment and start; do not start threads yourself.",
        "When a closing review reports, act on it: create the next round's tasks, or tell the user the work is done.",
      ],
      promptSnippet: "Create a task from its current state and goal state",
      run: (params) =>
        orchestrator.createTask(params).then((task) => prompts.formatTaskList([task])),
    }),
    list_tasks: tool({
      annotations: { readOnlyHint: true },
      description: "List tasks with status, round, dependencies, assignments, and conditions.",
      label: "list tasks",
      name: "list_tasks",
      parameters: Type.Object({}),
      promptSnippet: "List the task DAG",
      run: () => orchestrator.list().then(prompts.formatTaskList),
    }),
    read_task: tool({
      annotations: { readOnlyHint: true },
      description:
        "Read a task's current state, goal state, reports, dependencies, dependents, and threads.",
      label: "read task",
      name: "read_task",
      parameters: taskIdObject,
      promptSnippet: "Read a task's full state and reports",
      run: ({ taskId }) =>
        orchestrator.read(taskId).then((task) =>
          prompts.formatTaskDetail(
            task,
            task.assignments.map((assignment) => `${assignment.threadId} (${assignment.role})`),
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
        "Dependencies and states can change after creation: while a task has not started, set_task_depends and set_task_state rewrite them in place. Stop a running task before changing what it waits for or where it must end up.",
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
    set_task_state: tool({
      name: "set_task_state",
      label: "set task state",
      description:
        "Rewrite the current state or the goal state of a task that has not started. Write states, not steps: steps break once the starting state is not what you assumed. A running task is rejected: stop it first, or steer it with send_message.",
      promptSnippet: "Rewrite the states of a task that has not started",
      parameters: stateSchema,
      run: (params) =>
        orchestrator
          .setState(params)
          .then(
            (task) =>
              `${task.id} ${task.title}\nCurrent state: ${task.currentState}\nGoal state: ${task.goalState}`,
          ),
    }),
  };
}
