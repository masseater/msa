import type { AgentTool } from "@msa/agent-core";
import type { AssistantMessage, ToolCall } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

import type { AgentSession } from "../src/core/agent-session.ts";
import {
  type BuildSystemPromptOptions,
  normalizeBuildSystemPromptOptions,
} from "../src/core/system-prompt.ts";
import type agentSessionConcurrentSupportTypes from "./agent-session-concurrent-support.types.ts";
import sessionKit from "./session-kit.ts";
import type sessionKitTypes from "./session-kit.types.ts";

const { runTest } = testing;
const { assistantMessage, reply } = sessionKit;

const toolUsage: AssistantMessage["usage"] = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 1,
  output: 1,
  totalTokens: 2,
};

const dummyTool: AgentTool = {
  description: "Dummy tool",
  execute: (_toolCallId, params) =>
    runTest(
      Effect.succeed({
        content: [{ text: `result:${(params as { q: string }).q}`, type: "text" as const }],
        details: {},
      }),
    ),
  label: "dummy",
  name: "dummy",
  parameters: Type.Object({ q: Type.String() }),
};

const dummyCall = (id: string, q: string): ToolCall => ({
  arguments: { q },
  id,
  name: "dummy",
  type: "toolCall",
});

const toolCallResponder =
  (content: AssistantMessage["content"]): sessionKitTypes.Responder =>
  ({ context, stream }) => {
    const done = context.messages.some((message) => message.role === "toolResult");
    reply(
      stream,
      done
        ? assistantMessage("done", { usage: toolUsage })
        : assistantMessage("", { content, stopReason: "toolUse", usage: toolUsage }),
    );
  };

const installExtensionRunner = (
  session: AgentSession,
  handlers: agentSessionConcurrentSupportTypes.RunnerHandlers,
): void => {
  const runner = {
    emit: () => runTest(Effect.void),
    emitBeforeAgentStart: (_trigger: unknown, systemPromptOptions: BuildSystemPromptOptions) =>
      runTest(
        Effect.succeed({
          messages: [],
          systemPromptOptions: normalizeBuildSystemPromptOptions(systemPromptOptions),
        }),
      ),
    emitInput: () => runTest(Effect.succeed({ action: "continue" as const })),
    emitMessageEnd: handlers.emitMessageEnd ?? (() => runTest(Effect.as(Effect.void, undefined))),
    emitToolCall: handlers.emitToolCall ?? (() => runTest(Effect.as(Effect.void, undefined))),
    hasHandlers: (eventType: string) =>
      eventType === "tool_call" && handlers.emitToolCall !== undefined,
    invalidate: () => {},
  };
  Reflect.set(session, "_extensionRunner", runner);
};

const agentSessionConcurrentSupport = {
  dummyCall,
  dummyTool,
  installExtensionRunner,
  toolCallResponder,
};

export default agentSessionConcurrentSupport;
