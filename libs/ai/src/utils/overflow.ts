import { Function } from "effect";

import type { AssistantMessage } from "../types.ts";

const OVERFLOW_PATTERNS = [
  /prompt (?:is )?too long/iu,
  /prompt exceeds max length/iu,
  /request_too_large/iu,
  /input is too long for requested model/iu,
  /exceeds the context window/iu,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/iu,
  /input token count.*exceeds the maximum/iu,
  /maximum prompt length is \d+/iu,
  /reduce the length of the messages/iu,
  /maximum context length is \d+ tokens/iu,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/iu,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/iu,
  /exceeds the available context size/iu,
  /greater than the context length/iu,
  /context window exceeds limit/iu,
  /exceeded model token limit/iu,
  /too large for model with \d+ maximum context length/iu,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/iu,
  /model_context_window_exceeded/iu,
  /prompt too long; exceeded (?:max )?context length/iu,
  /range of input length should be/iu,
  /context[_ ]length[_ ]exceeded/iu,
  /too many tokens/iu,
  /token limit exceeded/iu,
];

const CEREBRAS_BODYLESS_OVERFLOW_PATTERN = /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/iu;

const NON_OVERFLOW_PATTERNS = [
  /^(Throttling error|Service unavailable):/iu,
  /rate limit/iu,
  /too many requests/iu,
];

export function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean {
  if (
    message.stopReason === "error" &&
    message.errorMessage !== undefined &&
    message.errorMessage !== ""
  ) {
    const isNonOverflow = NON_OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!));
    if (!isNonOverflow) {
      if (OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!))) {
        return true;
      }
      if (
        message.provider === "cerebras" &&
        CEREBRAS_BODYLESS_OVERFLOW_PATTERN.test(message.errorMessage)
      ) {
        return true;
      }
    }
  }

  if (
    contextWindow !== undefined &&
    contextWindow !== 0 &&
    !Number.isNaN(contextWindow) &&
    message.stopReason === "stop"
  ) {
    const inputTokens = message.usage.input + message.usage.cacheRead;
    if (inputTokens > contextWindow) {
      return true;
    }
  }

  if (
    contextWindow !== undefined &&
    contextWindow !== 0 &&
    !Number.isNaN(contextWindow) &&
    message.stopReason === "length" &&
    message.usage.output === 0
  ) {
    const inputTokens = message.usage.input + message.usage.cacheRead;
    if (inputTokens >= contextWindow * 0.99) {
      return true;
    }
  }

  return false;
}

export const isRecoverableLength: {
  (desiredMaxOutput: number): (message: AssistantMessage) => boolean;
  (message: AssistantMessage, desiredMaxOutput: number): boolean;
} = Function.dual(2, function (message: AssistantMessage, desiredMaxOutput: number): boolean {
  return (
    message.stopReason === "length" &&
    desiredMaxOutput > 0 &&
    message.usage.output < desiredMaxOutput
  );
});

export function getOverflowPatterns(): RegExp[] {
  return [...OVERFLOW_PATTERNS];
}
