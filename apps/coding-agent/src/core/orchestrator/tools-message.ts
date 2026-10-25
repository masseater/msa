import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import type orchestratorTypes from "./orchestrator.types.ts";
import promptsModule from "./prompts.ts";
import toolSupport from "./tool-support.ts";

const { taskIdObject, taskIdSchema, tool } = toolSupport;
const { prompts } = promptsModule;

const messageSchema = Type.Object({
  message: Type.String({
    description:
      "Steers a running thread, waits in the prompt of one that has not started, answers a task that waits for a decision, or reruns a finished one.",
  }),
  taskId: taskIdSchema,
});

const adviseSchema = Type.Object({
  question: Type.Optional(
    Type.String({ description: "What you want the advisor to weigh, beyond the request." }),
  ),
  taskId: taskIdSchema,
});

const noteSchema = Type.Object({
  audience: Type.Union([Type.Literal("all"), Type.Literal("round"), Type.Literal("tasks")], {
    description: "Who receives the note.",
  }),
  content: Type.String({ description: "The instruction shared with the tasks." }),
  round: Type.Optional(Type.String({ description: "Round id, when audience is round." })),
  taskIds: Type.Optional(
    Type.Array(taskIdSchema, { description: "Tasks, when audience is tasks." }),
  ),
});

const searchSchema = Type.Object({
  limit: Type.Optional(Type.Integer({ maximum: 50, minimum: 1 })),
  query: Type.String({ description: "Words to find in reports across every task and thread." }),
});

const maxConcurrentSchema = Type.Object({
  value: Type.Integer({ description: "Threads that may run at the same time.", minimum: 1 }),
});

function messageToolsA(
  orchestrator: orchestratorTypes.Orchestrator,
): Record<string, extensionsTypesTypes.ToolDefinition> {
  return {
    send_message: tool({
      description:
        "Send a message to a task. A running thread is steered at once; a task that has not started keeps it and receives it in its prompt when it starts; a task that waits for a decision continues in the thread that stopped, with the message as the decision, and so does one waiting for a decision after a provider error; a finished task reruns in a new thread.",
      label: "send message",
      name: "send_message",
      parameters: messageSchema,
      promptSnippet: "Steer, queue a message for, answer, or rerun a task",
      run: ({ taskId, message }) =>
        orchestrator.sendMessage(taskId, message).then((task) => prompts.formatTaskList([task])),
    }),
    send_note: tool({
      description:
        "Share one note with every task, one round, or a set of tasks. Running threads are steered at once; waiting tasks receive it when they start, and threads that stop between turns receive it before continuing.",
      label: "send note",
      name: "send_note",
      parameters: noteSchema,
      promptGuidelines: [
        "Use send_note for instructions that apply to several tasks, such as a file another task will delete.",
      ],
      promptSnippet: "Share a note with tasks, rounds, or all work",
      run: ({ content, audience, round, taskIds }) =>
        orchestrator
          .sendNote({
            audience,
            content,
            ...(round === undefined ? {} : { round }),
            ...(taskIds === undefined ? {} : { taskIds }),
          })
          .then((delivery) =>
            [
              `Note ${delivery.noteId} sent.`,
              delivery.steeredThreads.length > 0
                ? `Steered: ${delivery.steeredThreads.join(", ")}.`
                : "No running thread matched; waiting tasks will receive it when they start.",
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

function messageToolsC(
  orchestrator: orchestratorTypes.Orchestrator,
): Record<string, extensionsTypesTypes.ToolDefinition> {
  return {
    search_reports: tool({
      annotations: { readOnlyHint: true },
      description: "Full-text search across the reports of every task and thread.",
      label: "search reports",
      name: "search_reports",
      parameters: searchSchema,
      promptSnippet: "Search reports across tasks and threads",
      run: ({ query, limit }) =>
        orchestrator
          .searchReports(query, limit)
          .then((hits) =>
            hits.length === 0
              ? "No matching reports."
              : hits
                  .map(
                    (hit) =>
                      `- ${hit.taskTitle} (${hit.report.role}, ${hit.threadModel}): ${hit.report.content.slice(0, 240)}`,
                  )
                  .join("\n"),
          ),
    }),
  };
}

function messageToolsB(
  orchestrator: orchestratorTypes.Orchestrator,
): Record<string, extensionsTypesTypes.ToolDefinition> {
  return {
    rerun_task: tool({
      description:
        "Run a finished, failed, or stopped task again in a new thread. Dependencies and notes apply as usual.",
      label: "rerun task",
      name: "rerun_task",
      parameters: taskIdObject,
      promptSnippet: "Rerun a task in a new thread",
      run: ({ taskId }) =>
        orchestrator.rerun(taskId).then((task) => `${task.id} is ${task.status}.`),
    }),
    set_max_concurrent_threads: tool({
      description: "Change how many threads may run at the same time, from now on.",
      label: "set max concurrent threads",
      name: "set_max_concurrent_threads",
      parameters: maxConcurrentSchema,
      promptSnippet: "Change the concurrency limit",
      run: ({ value }) =>
        orchestrator
          .setMaxConcurrentThreads(value)
          .then((max) => `Max concurrent threads: ${max}.`),
    }),
    stop_task: tool({
      description:
        "Stop a task, aborting its running thread. Dependents keep waiting until it is rerun, or you remove the dependency.",
      label: "stop task",
      name: "stop_task",
      parameters: taskIdObject,
      promptSnippet: "Stop a task",
      run: ({ taskId }) =>
        orchestrator.stop(taskId).then((task) => `${task.id} is ${task.status}.`),
    }),
  };
}

function decisionTools(
  orchestrator: orchestratorTypes.Orchestrator,
): Record<string, extensionsTypesTypes.ToolDefinition> {
  return {
    consult_advisor: tool({
      description:
        "Start an advisor thread for a task that waits for a decision. The advisor reads the task, its decision request, its reports, and the code, weighs the options, and recommends one; its report comes back to you, and the task keeps waiting for your send_message.",
      label: "consult advisor",
      name: "consult_advisor",
      parameters: adviseSchema,
      promptGuidelines: [
        "A decision request or a stop for work that is not moving reaches needs-decision only after a triage thread found that only the user can decide (billing, personal data, revoking an existing key, or a choice of specification nobody has made), found only a compromise, or saw the same request come back after it decided it; CI that does not finish and a review the harness cannot judge come to you directly. Do not lower the goal to let it pass: decide with the user, or after consult_advisor, then answer with send_message, or change the goal with set_task_state first when the user agrees.",
      ],
      promptSnippet: "Have an independent thread weigh a decision's options",
      run: ({ taskId, question }) =>
        orchestrator.advise(taskId, question ?? "").then((task) => prompts.formatTaskList([task])),
    }),
  };
}

const toolsMessage = {
  decisionTools,
  messageToolsA,
  messageToolsB,
  messageToolsC,
};

export default toolsMessage;
