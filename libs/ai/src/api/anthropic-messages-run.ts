import type Anthropic from "@anthropic-ai/sdk";
import type { BetaInputTransformation } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type { Api, AssistantMessage, Model } from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import { appendAssistantMessageDiagnostic } from "../utils/diagnostics.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import {
  assertRequestAuth,
  createClient,
  getAnthropicFederation,
} from "./anthropic-messages-client.ts";
import { resolveCacheRetention } from "./anthropic-messages-compat.ts";
import type { AnthropicOptions } from "./anthropic-messages-options.ts";
import { describeThrown } from "./anthropic-sse.ts";

interface RunState {
  readonly model: Model<"anthropic-messages">;
  readonly output: AssistantMessage;
  readonly options: AnthropicOptions | undefined;
  readonly events: AssistantMessageEventStream;
  readonly client: Anthropic;
}

interface ResolveClientInput {
  readonly model: Model<"anthropic-messages">;
  readonly options: AnthropicOptions | undefined;
}

function resolveClient(input: ResolveClientInput): Anthropic {
  const { model, options } = input;
  if (options?.client !== undefined) return options.client;
  const apiKey = options?.apiKey;
  const federation = getAnthropicFederation({
    model,
    apiKey,
    headers: options?.headers,
    env: options?.env,
  });
  if (federation === undefined) {
    assertRequestAuth({ provider: model.provider, apiKey, headers: options?.headers });
  }
  const cacheRetention = resolveCacheRetention({
    cacheRetention: options?.cacheRetention,
    env: options?.env,
  });
  const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
  return createClient({
    model,
    apiKey,
    optionsHeaders: options?.headers,
    fetch: options?.fetch,
    sessionId: cacheSessionId,
    federation,
  });
}

function createOutput(model: Model<"anthropic-messages">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api as Api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: currentTimeMillis(),
  };
}

interface FinalizeStreamInput {
  readonly output: AssistantMessage;
  readonly events: AssistantMessageEventStream;
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
      type: "anthropic_input_transformations",
      timestamp: currentTimeMillis(),
      details: {
        transformations: inputTransformations.map((transformation) => ({
          type: transformation.type ?? undefined,
          path: transformation.path ?? undefined,
          reason: transformation.reason ?? undefined,
        })),
      },
    });
  }
  events.push({ type: "done", reason: output.stopReason, message: output });
  events.end();
}

interface FailStreamInput {
  readonly output: AssistantMessage;
  readonly events: AssistantMessageEventStream;
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
  output.errorMessage = describeThrown(error);
  events.push({ type: "error", reason: output.stopReason, error: output });
  events.end();
}

export { createOutput, failStream, finalizeStream, resolveClient, type RunState };
