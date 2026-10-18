import type { ResponseInput } from "openai/resources/responses/responses.js";

import type { AssistantMessage, Model } from "../types.ts";
import { normalizeContext } from "../utils/transcript.ts";
import { CODEX_TOOL_CALL_PROVIDERS, type CodexRequestBody } from "./openai-codex-options.ts";
import type {
  CachedWebSocketConnection,
  CachedWebSocketContinuationState,
} from "./openai-codex-ws-cache.ts";
import { convertResponsesMessages } from "./openai-responses-messages.ts";

function bodyWithoutInput(body: CodexRequestBody): string {
  const { input: _input, previous_response_id: _previousResponseId, ...rest } = body;
  return JSON.stringify(rest);
}

function inputDelta(
  body: CodexRequestBody,
  continuation: CachedWebSocketContinuationState,
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

export function continuationRequestBody(
  entry: CachedWebSocketConnection,
): (body: CodexRequestBody) => CodexRequestBody {
  return (body) => {
    const continuation = entry.continuation;
    if (continuation === undefined) return body;
    const delta = inputDelta(body, continuation);
    if (delta === undefined || continuation.lastResponseId === "") {
      entry.continuation = undefined;
      return body;
    }
    return { ...body, previous_response_id: continuation.lastResponseId, input: delta };
  };
}

export interface ResponseItemsSource {
  readonly model: Model<"openai-codex-responses">;
  readonly output: AssistantMessage;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
}

export function collectWebSocketResponseItems({
  model,
  output,
  grammarToolInputProperties,
}: ResponseItemsSource): ResponseInput {
  return convertResponsesMessages(
    model,
    normalizeContext({ messages: [output] }),
    CODEX_TOOL_CALL_PROVIDERS,
    { includeSystemPrompt: false, grammarToolInputProperties },
  ).filter(
    (item) => item.type !== "function_call_output" && item.type !== "custom_tool_call_output",
  );
}
