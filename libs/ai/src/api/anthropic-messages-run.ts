import type Anthropic from "@anthropic-ai/sdk";
import type { BetaInputTransformation } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type typesModule from "../types.types.ts";
import clock from "../utils/clock.ts";
import diagnosticsModule from "../utils/diagnostics.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import anthropicMessagesClient from "./anthropic-messages-client.ts";
import anthropicMessagesCompat from "./anthropic-messages-compat.ts";
import type anthropicMessagesOptionsTypes from "./anthropic-messages-options.ts";
import anthropicSse from "./anthropic-sse.ts";

const { assertRequestAuth, createClient, getAnthropicFederation } = anthropicMessagesClient;
const { resolveCacheRetention } = anthropicMessagesCompat;
const { currentTimeMillis } = clock;
const { appendAssistantMessageDiagnostic } = diagnosticsModule;
const { recordThrown } = anthropicSse;

interface ResolveClientInput {
  readonly model: typesModule.Model<"anthropic-messages">;
  readonly options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
}

function resolveClient(input: ResolveClientInput): Anthropic {
  const { model, options } = input;
  if (options?.client !== undefined) return options.client;
  const apiKey = options?.apiKey;
  const federation = getAnthropicFederation({
    apiKey,
    env: options?.env,
    headers: options?.headers,
    model,
  });
  if (federation === undefined) {
    assertRequestAuth({ apiKey, headers: options?.headers, provider: model.provider });
  }
  const cacheRetention = resolveCacheRetention({
    cacheRetention: options?.cacheRetention,
    env: options?.env,
  });
  const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
  return createClient({
    apiKey,
    federation,
    fetch: options?.fetch,
    model,
    optionsHeaders: options?.headers,
    sessionId: cacheSessionId,
  });
}

function createOutput(
  model: typesModule.Model<"anthropic-messages">,
): typesModule.AssistantMessage {
  return {
    api: model.api as typesModule.Api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "pending",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

interface FinalizeStreamInput {
  readonly output: typesModule.AssistantMessage;
  readonly events: eventStreamTypes.AssistantMessageEventStream;
  readonly inputTransformations: BetaInputTransformation[] | undefined;
  readonly signal: AbortSignal | undefined;
}

function finalizeStream(input: FinalizeStreamInput): void {
  const { output, events, inputTransformations, signal } = input;
  if (signal?.aborted === true) {
    throw new Error("Request was aborted");
  }
  if (output.stopReason === "pending") {
    throw new Error("Anthropic stream ended without a stop reason");
  }
  if (output.stopReason === "aborted" || output.stopReason === "error") {
    throw new Error(output.errorMessage || "An unknown error occurred");
  }
  if (inputTransformations !== undefined && inputTransformations.length > 0) {
    appendAssistantMessageDiagnostic(output, {
      details: {
        transformations: inputTransformations.map((transformation) => ({
          path: transformation.path ?? undefined,
          reason: transformation.reason ?? undefined,
          type: transformation.type ?? undefined,
        })),
      },
      timestamp: currentTimeMillis(),
      type: "anthropic_input_transformations",
    });
  }
  events.push({ message: output, reason: output.stopReason, type: "done" });
  events.end();
}

interface FailStreamInput {
  readonly output: typesModule.AssistantMessage;
  readonly events: eventStreamTypes.AssistantMessageEventStream;
  readonly error: unknown;
  readonly signal: AbortSignal | undefined;
}

function failStream(input: FailStreamInput): void {
  const { output, events, error, signal } = input;
  for (const block of output.content) {
    delete (block as { index?: number }).index;
    delete (block as { partialJson?: string }).partialJson;
  }
  output.stopReason = signal?.aborted === true ? "aborted" : "error";
  recordThrown(output, error);
  events.push({ error: output, reason: output.stopReason, type: "error" });
  events.end();
}

const anthropicMessagesRun = {
  createOutput,
  failStream,
  finalizeStream,
  resolveClient,
};

export default anthropicMessagesRun;
