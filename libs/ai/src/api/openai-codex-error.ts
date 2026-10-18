import { Data } from "effect";

import { formatThrownValue } from "../utils/diagnostics.ts";

const WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached";
const PREVIOUS_RESPONSE_NOT_FOUND_CODE = "previous_response_not_found";

export class CodexStreamError extends Data.TaggedError("CodexStreamError")<{
  readonly message: string;
  readonly kind: "api" | "protocol" | "callback";
  readonly code?: string | undefined;
  readonly payload?: unknown;
  readonly cause?: unknown;
}> {}

export interface CodexProtocolFailure {
  readonly source: "SSE" | "WebSocket";
  readonly cause: unknown;
  readonly payload: unknown;
}

export function codexProtocolError({ source, cause, payload }: CodexProtocolFailure) {
  return new CodexStreamError({
    message: `Invalid Codex ${source} JSON: ${formatThrownValue(cause)}`,
    kind: "protocol",
    cause,
    payload,
  });
}

export const isCodexNonTransportError = (error: unknown): boolean =>
  error instanceof CodexStreamError;

const hasApiCode = (error: unknown, code: string): boolean =>
  error instanceof CodexStreamError && error.kind === "api" && error.code === code;

export const isWebSocketConnectionLimitReachedError = (error: unknown): boolean =>
  hasApiCode(error, WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE);

export const isPreviousResponseNotFoundError = (error: unknown): boolean =>
  hasApiCode(error, PREVIOUS_RESPONSE_NOT_FOUND_CODE);

export const requestAbortedError = (): Error => new Error("Request was aborted");

export const throwIfRequestAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw requestAbortedError();
};
