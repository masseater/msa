import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import platform from "../platform.ts";
import claudeCodeContent from "./claude-code-content.ts";
import claudeCodeSessionOpen from "./claude-code-session-open.ts";
import type claudeCodeSessionTypes from "./claude-code-session.types.ts";
import claudeCodeSessions from "./claude-code-sessions.ts";

const { nowMs } = platform;
const { replyKey, toAnthropicContent, toCallToolResult } = claudeCodeContent;
const { openSession } = claudeCodeSessionOpen;
const { sessions } = claudeCodeSessions;

const PROVIDER_ID = "claude-subs";
const MAX_IDLE_SESSIONS = 2;

type SessionInstance = claudeCodeSessionTypes.Session;
type Config = claudeCodeSessionTypes.SessionConfig;

interface NewTurns {
  readonly toolResults: compatTypes.ToolResultMessage[];
  readonly userTurns: compatTypes.UserMessage[];
  readonly last: compatTypes.AssistantMessage | undefined;
}

function splitTurns(messages: readonly compatTypes.Message[]): NewTurns {
  let tail = messages.length;
  while (tail > 0 && messages[tail - 1]?.role !== "assistant") tail -= 1;
  const newTurns = messages.slice(tail);
  return {
    last: messages[tail - 1] as compatTypes.AssistantMessage | undefined,
    toolResults: newTurns.filter(
      (message): message is compatTypes.ToolResultMessage => message.role === "toolResult",
    ),
    userTurns: newTurns.filter(
      (message): message is compatTypes.UserMessage => message.role === "user",
    ),
  };
}

function resumeMode(session: SessionInstance, turns: NewTurns, config: Config) {
  if (session.busy || !session.matches(config)) return undefined;
  const { last, toolResults, userTurns } = turns;
  if (
    toolResults.length > 0 &&
    toolResults.every((result) => session.pending.has(result.toolCallId))
  )
    return "answers" as const;
  const continuesReply =
    toolResults.length === 0 &&
    userTurns.length > 0 &&
    session.pending.size === 0 &&
    last !== undefined &&
    last.provider.startsWith(PROVIDER_ID) &&
    session.lastReply === replyKey(last.content);
  return continuesReply ? ("continues" as const) : undefined;
}

const resume = (
  session: SessionInstance,
  mode: "answers" | "continues",
  turns: NewTurns,
  config: Config,
) =>
  Effect.gen(function* () {
    session.busy = true;
    yield* session.update(config);
    const userContent = turns.userTurns.flatMap((turn) => toAnthropicContent(turn.content));
    if (mode === "continues") {
      session.send(userContent);
      return session;
    }
    if (userContent.length > 0) session.send(userContent, "next");
    for (const result of turns.toolResults)
      session.deliver(result.toolCallId, toCallToolResult(result));
    return session;
  });

function evictStale(messages: readonly compatTypes.Message[]): void {
  const answered = new Set(
    messages.flatMap((message) => (message.role === "toolResult" ? [message.toolCallId] : [])),
  );
  for (const session of sessions) {
    if (!session.busy && [...session.pending].some((id) => answered.has(id))) session.close();
  }
  const idle = [...sessions]
    .filter((session) => !session.busy && session.pending.size === 0)
    .sort((a, b) => b.lastUsed - a.lastUsed);
  for (const session of idle.slice(MAX_IDLE_SESSIONS - 1)) session.close();
}

const attach = (messages: readonly compatTypes.Message[], config: Config) =>
  Effect.gen(function* () {
    const now = nowMs();
    for (const session of sessions) if (session.idleFor(now)) session.close();
    const turns = splitTurns(messages);
    for (const session of sessions) {
      const mode = resumeMode(session, turns, config);
      if (mode !== undefined) return yield* resume(session, mode, turns, config);
    }
    evictStale(messages);
    return yield* openSession(messages, config);
  });

const claudeCodeAttach = { PROVIDER_ID, attach };

export default claudeCodeAttach;
