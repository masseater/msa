import type { ResponseInput } from "openai/resources/responses/responses.js";

import transcript from "../utils/transcript.ts";
import openaiCodexOptions from "./openai-codex-options.ts";
import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";
import type openaiCodexWsCacheTypes from "./openai-codex-ws-cache.types.ts";
import type openaiCodexWsContinuationTypes from "./openai-codex-ws-continuation.types.ts";
import openaiResponsesMessages from "./openai-responses-messages.ts";

const { convertResponsesMessages } = openaiResponsesMessages;
const { normalizeContext } = transcript;
const { CODEX_TOOL_CALL_PROVIDERS } = openaiCodexOptions;

function bodyWithoutInput(body: openaiCodexOptionsTypes.CodexRequestBody): string {
  const { input: _input, previous_response_id: _previousResponseId, ...rest } = body;
  return JSON.stringify(rest);
}

function inputDelta(
  body: openaiCodexOptionsTypes.CodexRequestBody,
  continuation: openaiCodexWsCacheTypes.CachedWebSocketContinuationState,
): ResponseInput | undefined {
  if (bodyWithoutInput(body) !== bodyWithoutInput(continuation.lastRequestBody)) return undefined;
  const currentInput = body.input ?? [];
  const baseline = [
    ...(continuation.lastRequestBody.input ?? []),
    ...continuation.lastResponseItems,
  ];
  if (currentInput.length < baseline.length) return undefined;
  const prefix = currentInput.slice(0, baseline.length);
  if (JSON.stringify(prefix) !== JSON.stringify(baseline)) return undefined;
  return currentInput.slice(baseline.length);
}

function continuationRequestBody(
  entry: openaiCodexWsCacheTypes.CachedWebSocketConnection,
): (body: openaiCodexOptionsTypes.CodexRequestBody) => openaiCodexOptionsTypes.CodexRequestBody {
  return (body) => {
    const continuation = entry.continuation;
    if (continuation === undefined) return body;
    const delta = inputDelta(body, continuation);
    if (delta === undefined || continuation.lastResponseId === "") {
      entry.continuation = undefined;
      return body;
    }
    return { ...body, input: delta, previous_response_id: continuation.lastResponseId };
  };
}

function collectWebSocketResponseItems({
  model,
  output,
  grammarToolInputProperties,
}: openaiCodexWsContinuationTypes.ResponseItemsSource): ResponseInput {
  return convertResponsesMessages(
    model,
    normalizeContext({ messages: [output] }),
    CODEX_TOOL_CALL_PROVIDERS,
    { grammarToolInputProperties, includeSystemPrompt: false },
  ).filter(
    (item) => item.type !== "function_call_output" && item.type !== "custom_tool_call_output",
  );
}

const openaiCodexWsContinuation = {
  collectWebSocketResponseItems,
  continuationRequestBody,
};

export default openaiCodexWsContinuation;
