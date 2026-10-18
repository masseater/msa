import { ModelThinkingLevelSchema } from "@msa/ai/providers/model-schema";
import { type Static, type TSchema, Type } from "typebox";

import type { ToolDefinition } from "../extensions/types.ts";
import { formatSessionList, type Orchestrator } from "./orchestrator.ts";

export const ORCHESTRATOR_TOOL_NAMES = [
  "start_session",
  "list_sessions",
  "read_session",
  "send_to_session",
  "set_session_model",
  "stop_session",
] as const;

export function isOrchestratorTool(name: string): boolean {
  return (ORCHESTRATOR_TOOL_NAMES as readonly string[]).includes(name);
}

const modelSchema = Type.String({ description: 'Model as "provider/id".' });

const startSchema = Type.Object({
  title: Type.String({ description: "Short name of the work." }),
  prompt: Type.String({
    description: "The full task. The session sees nothing of this conversation but this prompt.",
  }),
  dependsOn: Type.Array(Type.String(), {
    description:
      "Ids of the sessions that must complete before this one starts; their reports are appended to the prompt. Always decide this: pass [] only when the work depends on no other session.",
  }),
  model: Type.Optional(modelSchema),
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  cwd: Type.Optional(Type.String({ description: "Working directory. Default: this session's." })),
});

const idSchema = Type.Object({ id: Type.String({ description: "Session id." }) });

const sendSchema = Type.Object({
  id: Type.String({ description: "Session id." }),
  message: Type.String({
    description: "Steers a running session, or reruns a finished one with this message.",
  }),
});

const setModelSchema = Type.Object({
  id: Type.String({ description: "Session id." }),
  model: modelSchema,
  thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
});

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

function tool<TParams extends TSchema>(
  definition: Omit<ToolDefinition<TParams, undefined>, "execute" | "defaultActive"> & {
    run: (params: Static<TParams>) => Promise<string>;
  },
): ToolDefinition {
  const { run, ...rest } = definition;
  const typed: ToolDefinition<TParams, undefined> = {
    ...rest,
    defaultActive: false,
    async execute(_toolCallId, params) {
      return text(await run(params));
    },
  };
  return typed as ToolDefinition;
}

export function createOrchestratorToolDefinitions(
  orchestrator: Orchestrator,
): Record<(typeof ORCHESTRATOR_TOOL_NAMES)[number], ToolDefinition> {
  return {
    start_session: tool({
      name: "start_session",
      label: "start session",
      description:
        "Start a separate session with its own context window to do one piece of work. Sessions run in parallel; one whose dependencies have not completed waits for them. Its report arrives in this conversation when it finishes. Every round of sessions ends in a review session that depends on all of them, runs alone, and reviews and redesigns the whole.",
      promptSnippet: "Start a separate session for a piece of work, declaring what it depends on",
      promptGuidelines: [
        "Answer simple questions yourself; send new work to sessions with start_session, one session per independent task.",
        "Always set dependsOn when calling start_session: list the sessions whose results the work needs, and pass [] only for work that needs none.",
        "Pick a model and thinkingLevel per session to match the work; omit them to use the configured worker defaults.",
        "When the review session reports, act on its redesign: start the next round of sessions or tell the user the work is done.",
      ],
      parameters: startSchema,
      run: async (params) => {
        const { session, review } = await orchestrator.start(params);
        return [
          `Started ${session.id} (${session.status}, round ${session.round}, model ${session.model}).`,
          `Round ${review.round} ends in ${review.id}, which depends on ${review.dependsOn.join(", ") || "nothing yet"}.`,
        ].join("\n");
      },
    }),
    list_sessions: tool({
      name: "list_sessions",
      label: "list sessions",
      description: "List the sessions of this conversation with status, model, and dependencies.",
      promptSnippet: "List the sessions this conversation started",
      parameters: Type.Object({}),
      run: async () => formatSessionList(await orchestrator.list()),
    }),
    read_session: tool({
      name: "read_session",
      label: "read session",
      description: "Read a session's full report, prompt, queued messages, and transcript file.",
      promptSnippet: "Read a session's full report",
      parameters: idSchema,
      run: async ({ id }) => {
        const node = await orchestrator.read(id);
        return [
          formatSessionList([node]),
          node.sessionFile ? `Transcript: ${node.sessionFile}` : undefined,
          node.pendingMessages.length > 0
            ? `<queued-messages>\n${node.pendingMessages.join("\n---\n")}\n</queued-messages>`
            : undefined,
          `<prompt>\n${node.prompt}\n</prompt>`,
          `<report>\n${node.report ?? ""}\n</report>`,
        ]
          .filter(Boolean)
          .join("\n\n");
      },
    }),
    send_to_session: tool({
      name: "send_to_session",
      label: "send to session",
      description:
        "Send a message to a session: steers it while it runs, queues it for a session that has not started yet, or reruns it after it finished, failed, or was stopped.",
      promptSnippet: "Steer, queue a message for, or rerun a session",
      parameters: sendSchema,
      run: async ({ id, message }) => formatSessionList([await orchestrator.send(id, message)]),
    }),
    set_session_model: tool({
      name: "set_session_model",
      label: "set session model",
      description:
        "Switch the model and thinking level of a session, including one that is running.",
      promptSnippet: "Switch a session's model",
      parameters: setModelSchema,
      run: async ({ id, model, thinkingLevel }) => {
        const node = await orchestrator.setModel(id, model, thinkingLevel);
        return `${node.id} now uses ${node.model} (thinking ${node.thinkingLevel}).`;
      },
    }),
    stop_session: tool({
      name: "stop_session",
      label: "stop session",
      description:
        "Stop a running or queued session. Sessions depending on it keep waiting until it is rerun or they are stopped.",
      promptSnippet: "Stop a session",
      parameters: idSchema,
      run: async ({ id }) => {
        const node = await orchestrator.stop(id);
        return `${node.id} is ${node.status}.`;
      },
    }),
  };
}
