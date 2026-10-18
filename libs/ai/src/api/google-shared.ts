import { FinishReason } from "@google/genai";
import { Effect, Function } from "effect";

import type { StopReason, StreamOptions } from "../types.ts";
import { retryProviderEffect } from "../utils/provider-retry.ts";

export function mapStopReason(reason: FinishReason): StopReason {
  switch (reason) {
    case FinishReason.STOP:
      return "stop";
    case FinishReason.MAX_TOKENS:
      return "length";
    case FinishReason.BLOCKLIST:
    case FinishReason.PROHIBITED_CONTENT:
    case FinishReason.SPII:
    case FinishReason.SAFETY:
    case FinishReason.IMAGE_SAFETY:
    case FinishReason.IMAGE_PROHIBITED_CONTENT:
    case FinishReason.IMAGE_RECITATION:
    case FinishReason.IMAGE_OTHER:
    case FinishReason.RECITATION:
    case FinishReason.FINISH_REASON_UNSPECIFIED:
    case FinishReason.OTHER:
    case FinishReason.LANGUAGE:
    case FinishReason.MALFORMED_FUNCTION_CALL:
    case FinishReason.UNEXPECTED_TOOL_CALL:
    case FinishReason.TOO_MANY_TOOL_CALLS:
    case FinishReason.NO_IMAGE:
      return "error";
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled stop reason: ${exhaustive}`);
    }
  }
}

export function mapStopReasonString(reason: string): StopReason {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    default:
      return "error";
  }
}

const withHeadersField = (error: unknown): unknown => {
  if (error instanceof Error && "status" in error && !("headers" in error)) {
    (error as { headers?: Headers | undefined }).headers = undefined;
  }
  return error;
};

export const retryGoogleRequest: {
  <T>(
    options?: Pick<StreamOptions, "maxRetries" | "maxRetryDelayMs" | "signal">,
  ): (request: () => Promise<T>) => Effect.Effect<T>;
  <T>(
    request: () => Promise<T>,
    options?: Pick<StreamOptions, "maxRetries" | "maxRetryDelayMs" | "signal">,
  ): Effect.Effect<T>;
} = Function.dual(
  (args) => typeof args[0] === "function",
  <T>(
    request: () => Promise<T>,
    options?: Pick<StreamOptions, "maxRetries" | "maxRetryDelayMs" | "signal">,
  ): Effect.Effect<T> =>
    retryProviderEffect(
      Effect.promise(() => Promise.resolve(request())).pipe(
        Effect.catchDefect((error) => Effect.die(withHeadersField(error))),
      ),
      {
        maxRetries: options?.maxRetries,
        maxRetryDelayMs: options?.maxRetryDelayMs,
        signal: options?.signal,
      },
    ),
);
