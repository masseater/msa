import type { AssistantMessage, Model, StreamOptions } from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { requestAbortedError } from "./openai-codex-error.ts";
import type { CodexRequestBody, OpenAICodexResponsesOptions } from "./openai-codex-options.ts";

export interface CodexStreamRun {
  readonly model: Model<"openai-codex-responses">;
  readonly output: AssistantMessage;
  readonly events: AssistantMessageEventStream;
  readonly options: OpenAICodexResponsesOptions | undefined;
  readonly body: CodexRequestBody;
  readonly bodyJson: string;
  readonly sseHeaders: Headers;
  readonly websocketHeaders: Headers;
  readonly httpTimeoutMs: number | undefined;
  readonly websocketConnectTimeoutMs: number | undefined;
  readonly cacheSessionId: string | undefined;
  readonly accountId: string;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
  readonly transport: NonNullable<StreamOptions["transport"]>;
  readonly emitStart: () => void;
}

export function finishCodexOutput({ options, output, events }: CodexStreamRun): void {
  if (options?.signal?.aborted === true) throw requestAbortedError();
  if (output.stopReason === "pending") throw new Error("Codex stream ended without a stop reason");
  if (output.stopReason === "error" || output.stopReason === "aborted") {
    throw new Error(output.errorMessage || "An unknown error occurred");
  }
  events.push({ type: "done", reason: output.stopReason, message: output });
  events.end();
}

export interface CodexFailure {
  readonly output: AssistantMessage;
  readonly events: AssistantMessageEventStream;
  readonly options: OpenAICodexResponsesOptions | undefined;
}

export function failCodexOutput({ output, events, options }: CodexFailure) {
  return (error: unknown): void => {
    for (const block of output.content) {
      delete (block as { partialJson?: string }).partialJson;
      delete (block as { customInput?: unknown }).customInput;
    }
    output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
    output.errorMessage = formatProviderError(normalizeProviderError(error));
    events.push({ type: "error", reason: output.stopReason, error: output });
    events.end();
  };
}
