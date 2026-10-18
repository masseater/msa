import { Effect } from "effect";

import type { TranscriptContext } from "../types.ts";
import { callHook } from "../utils/hooks.ts";
import { encodeJsonSync } from "../utils/json-codec.ts";
import { uuidv7 } from "../utils/uuid.ts";
import { buildCodexRequestBody, codexGrammarProperties } from "./openai-codex-body.ts";
import {
  buildSSEHeaders,
  buildWebSocketHeaders,
  extractAccountId,
} from "./openai-codex-headers.ts";
import type { CodexRequestBody } from "./openai-codex-options.ts";
import type { CodexStreamRun } from "./openai-codex-stream-run.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";

function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid timeoutMs: ${String(value)}`);
  }
  return Math.floor(value);
}

export interface CodexRunRequest extends Pick<
  CodexStreamRun,
  "model" | "output" | "events" | "options"
> {
  readonly context: TranscriptContext;
}

function requireApiKey({ model, options }: CodexRunRequest): string {
  const apiKey = options?.apiKey;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  return apiKey;
}

function startEmitter({ output, events }: CodexRunRequest): () => void {
  let emitted = false;
  return () => {
    if (emitted) return;
    emitted = true;
    events.push({ type: "start", partial: output });
  };
}

export const prepareCodexRun = Effect.fn("prepareCodexRun")(function* (request: CodexRunRequest) {
  const { model, context, options } = request;
  const token = requireApiKey(request);
  const accountId = extractAccountId(token);
  const grammarToolInputProperties = codexGrammarProperties(model)(context);
  const cacheSessionId = options?.cacheRetention === "none" ? undefined : options?.sessionId;
  const codexSessionId = clampOpenAIPromptCacheKey(cacheSessionId);
  const builtBody = buildCodexRequestBody({
    model,
    context,
    options,
    cacheSessionId: codexSessionId,
    grammarToolInputProperties,
  });
  const nextBody = yield* callHook(() => options?.onPayload?.(builtBody, model));
  const body = (nextBody ?? builtBody) as CodexRequestBody;
  const credentials = {
    modelHeaders: model.headers,
    optionHeaders: options?.headers,
    accountId,
    token,
  };
  return {
    ...request,
    body,
    bodyJson: encodeJsonSync(body),
    sseHeaders: buildSSEHeaders(credentials)(codexSessionId),
    websocketHeaders: buildWebSocketHeaders(credentials)(codexSessionId || uuidv7()),
    httpTimeoutMs: normalizeTimeoutMs(options?.timeoutMs),
    websocketConnectTimeoutMs: normalizeTimeoutMs(options?.websocketConnectTimeoutMs),
    cacheSessionId,
    accountId,
    grammarToolInputProperties,
    transport: options?.transport || "auto",
    emitStart: startEmitter(request),
  } satisfies CodexStreamRun;
});
