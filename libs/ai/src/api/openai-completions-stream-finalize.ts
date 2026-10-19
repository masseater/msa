import type { AssistantMessage } from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { finishAllBlocks } from "./openai-completions-stream-state.ts";
import type { CompletionsStreamState } from "./openai-completions-stream-types.ts";

function finalizeCompletionsStream(state: CompletionsStreamState): void {
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
  state.events.push({ type: "done", reason: output.stopReason, message: output });
  state.events.end();
}

interface FailStreamInput {
  readonly output: AssistantMessage;
  readonly events: AssistantMessageEventStream;
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
  output.errorMessage = formatProviderError(normalizeProviderError(error));
  const rawMetadata = (error as any)?.error?.metadata?.raw;
  if (Boolean(rawMetadata) && !output.errorMessage.includes(String(rawMetadata))) {
    output.errorMessage += `\n${rawMetadata}`;
  }
  events.push({ type: "error", reason: output.stopReason, error: output });
  events.end();
}

export { failCompletionsStream, finalizeCompletionsStream };
