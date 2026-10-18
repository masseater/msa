import { Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { prompts } from "./prompts.ts";
import { taskIdObject, taskIdSchema, tool } from "./tool-support.ts";

const messageSchema = Type.Object({
  taskId: taskIdSchema,
  message: Type.String({
    description:
      "Steers a running session, waits in the prompt of one that has not started, or reruns a finished one.",
  }),
});

const noteSchema = Type.Object({
  content: Type.String({ description: "The instruction shared with the tasks." }),
  audience: Type.Union([Type.Literal("all"), Type.Literal("round"), Type.Literal("tasks")], {
    description: "Who receives the note.",
  }),
  round: Type.Optional(Type.String({ description: "Round id, when audience is round." })),
  taskIds: Type.Optional(Type.Array(taskIdSchema, { description: "Tasks, when audience is tasks." })),
});

const searchSchema = Type.Object({
  query: Type.String({ description: "Words to find in reports across every task and session." }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

const maxConcurrentSchema = Type.Object({
  value: Type.Integer({ minimum: 1, description: "Sessions that may run at the same time." }),
});

export function messageToolsA(orchestrator: Orchestrator): Record<string, ToolDefinition> {
  return {
    send_message: tool({
      name: "send_message",
      label: "send message",
      description:
        "Send a message to a task. A running session is steered at once; a task that has not started keeps it and receives it in its prompt when it starts; a finished task reruns in a new session.",
      promptSnippet: "Steer, queue a message for, or rerun a task",
      parameters: messageSchema,
      run: ({ taskId, message }) =>
        orchestrator.sendMessage(taskId, message).then((task) => prompts.formatTaskList([task])),
    }),
    send_note: tool({
      name: "send_note",
      label: "send note",
      description:
        "Share one note with every task, one round, or a set of tasks. Running sessions are steered at once; waiting tasks receive it when they start, and sessions that stop between turns receive it before continuing.",
      promptSnippet: "Share a note with tasks, rounds, or all work",
      promptGuidelines: [
        "Use send_note for instructions that apply to several tasks, such as a file another task will delete.",
      ],
      parameters: noteSchema,
      run: ({ content, audience, round, taskIds }) =>
        orchestrator
          .sendNote({
            content,
            audience,
            ...(round === undefined ? {} : { round }),
            ...(taskIds === undefined ? {} : { taskIds }),
          })
          .then((delivery) =>
            [
              `Note ${delivery.noteId} sent.`,
              delivery.steeredSessions.length > 0
                ? `Steered: ${delivery.steeredSessions.join(", ")}.`
                : "No running session matched; waiting tasks will receive it when they start.",
              delivery.waitingTasks.length > 0
                ? `Waiting: ${delivery.waitingTasks.join(", ")}.`
                : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
          ),
    }),
  };
}

export function messageToolsC(orchestrator: Orchestrator): Record<string, ToolDefinition> {
  return {
    search_reports: tool({
      name: "search_reports",
      label: "search reports",
      description: "Full-text search across the reports of every task and session.",
      promptSnippet: "Search reports across tasks and sessions",
      parameters: searchSchema,
      run: ({ query, limit }) =>
        orchestrator.searchReports(query, limit).then((hits) =>
          hits.length === 0
            ? "No matching reports."
            : hits
                .map(
                  (hit) =>
                    `- ${hit.taskTitle} (${hit.report.role}, ${hit.sessionModel}): ${hit.report.content.slice(0, 240)}`,
                )
                .join("\n"),
        ),
    }),
  };
}

export function messageToolsB(orchestrator: Orchestrator): Record<string, ToolDefinition> {
  return {
    stop_task: tool({
      name: "stop_task",
      label: "stop task",
      description:
        "Stop a task, aborting its running session. Dependents keep waiting until it is rerun, or you remove the dependency.",
      promptSnippet: "Stop a task",
      parameters: taskIdObject,
      run: ({ taskId }) => orchestrator.stop(taskId).then((task) => `${task.id} is ${task.status}.`),
    }),
    rerun_task: tool({
      name: "rerun_task",
      label: "rerun task",
      description:
        "Run a finished, failed, or stopped task again in a new session. Dependencies and notes apply as usual.",
      promptSnippet: "Rerun a task in a new session",
      parameters: taskIdObject,
      run: ({ taskId }) => orchestrator.rerun(taskId).then((task) => `${task.id} is ${task.status}.`),
    }),
    set_max_concurrent_sessions: tool({
      name: "set_max_concurrent_sessions",
      label: "set max concurrent sessions",
      description: "Change how many sessions may run at the same time, from now on.",
      promptSnippet: "Change the concurrency limit",
      parameters: maxConcurrentSchema,
      run: ({ value }) =>
        orchestrator.setMaxConcurrentSessions(value).then((max) => `Max concurrent sessions: ${max}.`),
    }),
  };
}
