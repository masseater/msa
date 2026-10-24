import type typesModule from "../types.types.ts";
import errorBody from "../utils/error-body.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import openaiCompletionsStreamState from "./openai-completions-stream-state.ts";
import type openaiCompletionsStreamTypesModule from "./openai-completions-stream-types.types.ts";

const { finishAllBlocks } = openaiCompletionsStreamState;
const { formatProviderError, normalizeProviderError, recordErrorStatus } = errorBody;

function finalizeCompletionsStream(
  state: openaiCompletionsStreamTypesModule.CompletionsStreamState,
): void {
  const { output, options, compat } = state;
  finishAllBlocks(state);
  if (options?.signal?.aborted === true) {
    throw new Error("Request was aborted");
  }
  if (output.stopReason === "aborted") {
    throw new Error("Request was aborted");
  }
  if (!state.hasFinishReason && !compat.supportsFinishReason) {
    output.stopReason = output.content.some((block) => block.type === "toolCall")
      ? "toolUse"
      : "stop";
  }
  if (output.stopReason === "error") {
    throw new Error(output.errorMessage || "Provider returned an error stop reason");
  }
  if ((compat.supportsFinishReason && !state.hasFinishReason) || output.stopReason === "pending") {
    throw new Error("Stream ended without finish_reason");
  }
  state.events.push({ message: output, reason: output.stopReason, type: "done" });
  state.events.end();
}

interface FailStreamInput {
  readonly output: typesModule.AssistantMessage;
  readonly events: eventStreamTypes.AssistantMessageEventStream;
  readonly error: unknown;
  readonly signal: AbortSignal | undefined;
}

function failCompletionsStream(input: FailStreamInput): void {
  const { output, events, error, signal } = input;
  for (const block of output.content) {
    delete (block as { index?: number }).index;
    delete (block as { partialArgs?: string }).partialArgs;
    delete (block as { customInput?: unknown }).customInput;
    delete (block as { streamIndex?: number }).streamIndex;
  }
  output.stopReason = signal?.aborted === true ? "aborted" : "error";
  const failure = normalizeProviderError(error);
  output.errorMessage = formatProviderError(failure);
  recordErrorStatus(output, failure);
  const rawMetadata = (error as any)?.error?.metadata?.raw;
  if (Boolean(rawMetadata) && !output.errorMessage.includes(String(rawMetadata))) {
    output.errorMessage += `\n${rawMetadata}`;
  }
  events.push({ error: output, reason: output.stopReason, type: "error" });
  events.end();
}

const openaiCompletionsStreamFinalize = {
  failCompletionsStream,
  finalizeCompletionsStream,
};

export default openaiCompletionsStreamFinalize;
