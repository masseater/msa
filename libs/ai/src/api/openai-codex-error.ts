import diagnosticsModule from "../utils/diagnostics.ts";
import CodexStreamError from "./codex-stream-error.ts";
import type openaiCodexErrorTypes from "./openai-codex-error.types.ts";

const { formatThrownValue } = diagnosticsModule;

const WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached";
const PREVIOUS_RESPONSE_NOT_FOUND_CODE = "previous_response_not_found";

function codexProtocolError({
  source,
  cause,
  payload,
}: openaiCodexErrorTypes.CodexProtocolFailure) {
  return new CodexStreamError({
    cause,
    kind: "protocol",
    message: `Invalid Codex ${source} JSON: ${formatThrownValue(cause)}`,
    payload,
  });
}

const isCodexNonTransportError = (error: unknown): boolean => error instanceof CodexStreamError;

const hasApiCode = (error: unknown, code: string): boolean =>
  error instanceof CodexStreamError && error.kind === "api" && error.code === code;

const isWebSocketConnectionLimitReachedError = (error: unknown): boolean =>
  hasApiCode(error, WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE);

const isPreviousResponseNotFoundError = (error: unknown): boolean =>
  hasApiCode(error, PREVIOUS_RESPONSE_NOT_FOUND_CODE);

const requestAbortedError = (): Error => new Error("Request was aborted");

const throwIfRequestAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw requestAbortedError();
};

const openaiCodexError = {
  CodexStreamError,
  codexProtocolError,
  isCodexNonTransportError,
  isPreviousResponseNotFoundError,
  isWebSocketConnectionLimitReachedError,
  requestAbortedError,
  throwIfRequestAborted,
};

export default openaiCodexError;
