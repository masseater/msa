import errorBody from "../utils/error-body.ts";
import openaiCodexError from "./openai-codex-error.ts";
import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";

const { requestAbortedError } = openaiCodexError;
const { formatProviderError, normalizeProviderError } = errorBody;

function finishCodexOutput({
  options,
  output,
  events,
}: openaiCodexStreamRunTypes.CodexStreamRun): void {
  if (options?.signal?.aborted === true) throw requestAbortedError();
  if (output.stopReason === "pending") throw new Error("Codex stream ended without a stop reason");
  if (output.stopReason === "error" || output.stopReason === "aborted") {
    throw new Error(output.errorMessage || "An unknown error occurred");
  }
  events.push({ message: output, reason: output.stopReason, type: "done" });
  events.end();
}

function failCodexOutput({ output, events, options }: openaiCodexStreamRunTypes.CodexFailure) {
  return (error: unknown): void => {
    for (const block of output.content) {
      delete (block as { partialJson?: string }).partialJson;
      delete (block as { customInput?: unknown }).customInput;
    }
    output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
    output.errorMessage = formatProviderError(normalizeProviderError(error));
    events.push({ error: output, reason: output.stopReason, type: "error" });
    events.end();
  };
}

const openaiCodexStreamRun = {
  failCodexOutput,
  finishCodexOutput,
};

export default openaiCodexStreamRun;
