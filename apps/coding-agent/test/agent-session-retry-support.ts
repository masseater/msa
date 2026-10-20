import type { AgentEvent, AgentTool, StreamFn } from "@msa/agent-core";
import type { AssistantMessage } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import type { AgentSession } from "../src/core/agent-session.ts";
import sessionKit from "./session-kit.ts";

const { awaited, runTest } = testing;
const { assistantMessage, createAgentSession, streamWith } = sessionKit;

const errorMessage = (text: string): AssistantMessage =>
  assistantMessage("", { errorMessage: text, stopReason: "error" });

const scriptedStream = (replies: (call: number) => AssistantMessage) => {
  let calls = 0;
  const streamFn: StreamFn = streamWith(({ stream }) => {
    calls++;
    const message = replies(calls);
    stream.push({ partial: message, type: "start" });
    if (message.stopReason === "error")
      stream.push({ error: message, reason: "error", type: "error" });
    else
      stream.push({
        message,
        reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
        type: "done",
      });
  });
  return { callCount: () => calls, streamFn };
};

const createRetrySession = Effect.fn("createRetrySession")(function* (options: {
  cwd: string;
  streamFn: StreamFn;
  retry: { maxRetries: number; maxAgentDelayMs?: number };
  tools?: AgentTool[];
}) {
  const created = yield* createAgentSession({
    cwd: options.cwd,
    streamFn: options.streamFn,
    ...(options.tools === undefined ? {} : { tools: options.tools }),
  });
  created.settingsManager.applyOverrides({
    retry: { baseDelayMs: 1, enabled: true, ...options.retry },
  });
  return created.session;
});

const delayAssistantMessageEnd = (session: AgentSession, delayMs: number): void => {
  const original = Reflect.get(session, "emitExtensionEvent") as (
    event: AgentEvent,
  ) => Promise<void>;
  Reflect.set(session, "emitExtensionEvent", (event: AgentEvent) =>
    runTest(
      Effect.gen(function* () {
        if (event.type === "message_end" && event.message.role === "assistant") {
          yield* Effect.sleep(delayMs);
        }
        yield* awaited(original.call(session, event));
      }),
    ),
  );
};

const retryEvents = (session: AgentSession): string[] => {
  const events: string[] = [];
  session.subscribe((event) => {
    if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
    if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
  });
  return events;
};

const agentSessionRetrySupport = {
  createRetrySession,
  delayAssistantMessageEnd,
  errorMessage,
  retryEvents,
  scriptedStream,
};

export default agentSessionRetrySupport;
