import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import type claudeAccountsTypes from "./claude-accounts.types.ts";
import claudeCodeContent from "./claude-code-content.ts";
import ClaudeCodeFailure from "./claude-code-failure.ts";
import claudeCodeQuery from "./claude-code-query.ts";
import claudeCodeSdk from "./claude-code-sdk.ts";
import type claudeCodeSessionTypes from "./claude-code-session.types.ts";
import type replyTypes from "./reply.types.ts";

const { replyKey } = claudeCodeContent;
const { loadSdk } = claudeCodeSdk;
const { SERVER } = claudeCodeQuery;

const TOOL_PREFIX = `mcp__${SERVER}__`;

type Session = claudeCodeSessionTypes.Session;
type Failure = claudeAccountsTypes.RunFailure;
type StreamEvent = Extract<SDKMessage, { type: "stream_event" }>["event"];

interface PumpState {
  readonly session: Session;
  readonly reply: replyTypes.ReplyBuilder;
  messageId: string;
  apiError: Failure["cause"];
  rejectedResetsAt: number | undefined;
  stopReason: string;
  sawPartials: boolean;
  calledTools: number;
  messageOutput: number;
}

type Outcome = { readonly failure: Failure | undefined } | void;

function onStreamEvent(state: PumpState, inner: StreamEvent): Outcome {
  const { reply } = state;
  state.sawPartials = true;
  if (inner.type === "message_start") {
    const usage = inner.message.usage;
    state.messageId = inner.message.id;
    state.messageOutput = 0;
    reply.addUsage({
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      input: usage.input_tokens,
    });
  } else if (inner.type === "content_block_delta") {
    const key = `${state.messageId}:${inner.index}`;
    if (inner.delta.type === "text_delta") reply.appendText(key, inner.delta.text);
    else if (inner.delta.type === "thinking_delta") reply.appendThinking(key, inner.delta.thinking);
  } else if (inner.type === "message_delta") {
    if (inner.delta.stop_reason !== null) state.stopReason = inner.delta.stop_reason;
    reply.addUsage({ output: inner.usage.output_tokens - state.messageOutput });
    state.messageOutput = inner.usage.output_tokens;
  } else if (
    inner.type === "message_stop" &&
    state.stopReason === "tool_use" &&
    state.calledTools > 0
  ) {
    reply.done("toolUse");
    return { failure: undefined };
  }
  return undefined;
}

function onAssistant(state: PumpState, event: Extract<SDKMessage, { type: "assistant" }>): void {
  const { message } = event;
  if (message.model === "<synthetic>") {
    state.apiError = event.error;
    return;
  }
  for (const [index, block] of message.content.entries()) {
    if (block.type === "tool_use" && block.name.startsWith(TOOL_PREFIX)) {
      state.session.pending.add(block.id);
      state.calledTools += 1;
      state.reply.toolCall(
        block.id,
        block.name.slice(TOOL_PREFIX.length),
        (block.input ?? {}) as compatTypes.JsonObject,
      );
    } else if (block.type === "text" && !state.sawPartials) {
      state.reply.setText(`${message.id}:${index}`, block.text);
    }
  }
}

function onRateLimit(state: PumpState, event: Extract<SDKMessage, { type: "rate_limit_event" }>) {
  const info = event.rate_limit_info;
  if (info.status !== "rejected") return;
  const resetsAt = (info.resetsAt ?? 0) * 1000;
  state.rejectedResetsAt = resetsAt === 0 || Number.isNaN(resetsAt) ? undefined : resetsAt;
}

const onResult = (state: PumpState, event: Extract<SDKMessage, { type: "result" }>) =>
  Effect.gen(function* () {
    if (!event.is_error) {
      state.reply.done("stop");
      state.session.lastReply = replyKey(state.reply.message.content);
      return { failure: undefined };
    }
    const error = event.subtype === "success" ? event.result : event.errors.join("\n");
    const { usageLimitPrefixes } = yield* Effect.tryPromise({
      catch: (cause) => ClaudeCodeFailure.fromCause(cause),
      try: loadSdk,
    });
    const limited =
      state.rejectedResetsAt !== undefined ||
      usageLimitPrefixes.some((prefix) => error.startsWith(prefix));
    const cause = limited ? "usage_limit" : state.apiError;
    const failure: Failure = {
      error: error === "" ? "Claude Code run failed" : error,
      ...(cause === undefined ? {} : { cause }),
      ...(state.rejectedResetsAt === undefined ? {} : { resetsAt: state.rejectedResetsAt }),
    };
    return { failure };
  });

const onEvent = (
  state: PumpState,
  event: SDKMessage,
): Effect.Effect<Outcome, InstanceType<typeof ClaudeCodeFailure>> => {
  if ("parent_tool_use_id" in event && (event.parent_tool_use_id ?? "") !== "") return Effect.void;
  if (event.type === "stream_event") return Effect.succeed(onStreamEvent(state, event.event));
  if (event.type === "assistant") return Effect.sync(() => onAssistant(state, event));
  if (event.type === "rate_limit_event") return Effect.sync(() => onRateLimit(state, event));
  if (event.type === "result") return onResult(state, event);
  return Effect.void;
};

const pump = (
  session: Session,
  reply: replyTypes.ReplyBuilder,
  model: compatTypes.Model<string>,
  options?: compatTypes.SimpleStreamOptions,
) =>
  Effect.gen(function* () {
    const state: PumpState = {
      apiError: undefined,
      calledTools: 0,
      messageId: "",
      messageOutput: 0,
      rejectedResetsAt: undefined,
      reply,
      sawPartials: false,
      session,
      stopReason: "",
    };
    while (true) {
      const next = yield* Effect.tryPromise({
        catch: (cause) => ClaudeCodeFailure.fromCause(cause),
        try: () => session.next(),
      });
      if (next.done === true) {
        const detail = session.exitDetail;
        return { error: detail === "" ? "Claude Code exited" : detail } satisfies Failure;
      }
      yield* Effect.ignore(
        Effect.tryPromise(() =>
          Promise.resolve(options?.onProviderStreamEvent?.(next.value, model)),
        ),
      );
      const outcome = yield* onEvent(state, next.value);
      if (outcome !== undefined) return outcome.failure;
    }
  });

const claudeCodePump = { pump };

export default claudeCodePump;
