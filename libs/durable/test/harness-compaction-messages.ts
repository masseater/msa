import { type Message, type UserMessage, fauxAssistantMessage } from "@msa/ai";
import type durableTypes from "@msa/durable/index.types";
import { dual } from "effect/Function";

import support from "./support.ts";

const { textOf } = support;

function textImpl(label: string, tokens: number): string {
  return `${label} ${"x".repeat(Math.max(0, tokens * 4 - label.length - 1))}`;
}

const text: {
  (tokens: number): (label: string) => ReturnType<typeof textImpl>;
  (label: string, tokens: number): ReturnType<typeof textImpl>;
} = dual(2, textImpl);

function isSummaryRequest(messages: readonly Message[]): boolean {
  const firstInner = messages[0];
  return (
    firstInner?.role === "system" &&
    typeof firstInner.content === "string" &&
    firstInner.content.startsWith("You are a context summarization assistant")
  );
}

const answer = (content: string) => fauxAssistantMessage(content);

const failure = (errorMessage: string) =>
  fauxAssistantMessage("", { errorMessage, stopReason: "error" });

const OVERFLOW = "prompt is too long: 250000 tokens > 200000 maximum";

const MANUAL: durableTypes.CompactionPolicy = {
  backgroundTokens: 0,
  enabled: false,
  keepRecentTokens: 150,
  reserveTokens: 1000,
};

function userText(message: Message | undefined): string {
  return textOf(message) ?? "";
}

function firstUserText(messages: readonly Message[]): string {
  return userText(messages.find((message) => message.role === "user"));
}

const user = (content: string): UserMessage => ({ content, role: "user", timestamp: 0 });

const BACKGROUND: durableTypes.CompactionPolicy = {
  backgroundTokens: 1000,
  enabled: true,
  keepRecentTokens: 150,
  reserveTokens: 500,
};

const BLOCKING: durableTypes.CompactionPolicy = {
  backgroundTokens: 0,
  enabled: true,
  keepRecentTokens: 150,
  reserveTokens: 300,
};

const ENABLED: durableTypes.CompactionPolicy = { ...MANUAL, enabled: true };

const summary = (content = "SUMMARY") => answer(content);

const harnessCompactionMessages = {
  BACKGROUND,
  BLOCKING,
  ENABLED,
  MANUAL,
  OVERFLOW,
  answer,
  failure,
  firstUserText,
  isSummaryRequest,
  summary,
  text,
  user,
  userText,
};

export default harnessCompactionMessages;
