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

const mergeSchema = Type.Object({
  head: Type.String({
    description:
      "Full SHA of the head you checked. The pull request merges only while this is still its head.",
  }),
  number: Type.Integer({ description: "Pull request number.", minimum: 1 }),
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
        "Send a message to a task. A running thread is steered at once; a task that has not started keeps it and receives it in its prompt when it starts; a task that waits for a decision continues in the thread that stopped, with the message as the decision; a finished task reruns in a new thread. When the task has checks and its cwd is no longer a git working tree, the call fails with the refusal, the task is stopped, and the way on is a replan with the task in from and cwd as a checkout.",
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
    merge_pull_request: tool({
      description:
        "Squash-merge a pull request the way the harness merges a task's pull request: only at the head you name, only while it is open, current with its base, free of conflicts and auto-merge, and green in CI, with its title and the commit messages of the pull request as the commit message. A task's pull request merges only while the task is stopped, failed, or completed; the task then completes and its worktree and branch are removed.",
      label: "merge pull request",
      name: "merge_pull_request",
      parameters: mergeSchema,
      promptGuidelines: [
        "Merge pull requests with merge_pull_request, never with gh pr merge, gh api, or the GitHub page: it checks the head you name and records the merge so the harness knows it as its own. When it refuses because CI is still running, wait for CI and call it again.",
      ],
      promptSnippet: "Squash-merge a pull request at a checked head",
      run: ({ number, head }) => orchestrator.mergePullRequest(number, head),
    }),
    rerun_task: tool({
      description:
        "Run a finished, failed, or stopped task again in a new thread. Dependencies and notes apply as usual. When the task has checks and its cwd is no longer a git working tree, the call fails with the refusal, the task stays stopped, and the way on is a replan with the task in from and cwd as a checkout.",
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
        "Start an advisor thread for a task that waits for a decision. The advisor reads the task, its decision request, its reports, and the code, looks up the user's earlier instructions and decisions with search_sessions, weighs the options, and recommends one; its report comes back to you, and the task keeps waiting for your send_message. When the task has checks and its cwd is no longer a git working tree, the call fails with the refusal, the task is stopped, and the way on is a replan with the task in from and cwd as a checkout.",
      label: "consult advisor",
      name: "consult_advisor",
      parameters: adviseSchema,
      promptGuidelines: [
        "A decision request or a stop for work that is not moving reaches needs-decision only after a triage thread found that only the user can decide (billing, personal data, revoking an existing key, or a choice of specification nobody has made), found only a compromise, or saw the same request come back after it decided it, in which case the report shows the earlier request and the way it decided beside this one, so a request that does not repeat it is answered with send_message; CI that does not finish and a review the harness cannot judge go through the same triage. Do not lower the goal to let it pass: decide with the user, or after consult_advisor, then answer with send_message, or change the goal with set_task_state first when the user agrees.",
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
