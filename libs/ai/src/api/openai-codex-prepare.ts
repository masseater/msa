import { Effect } from "effect";

import hooks from "../utils/hooks.ts";
import jsonCodec from "../utils/json-codec.ts";
import uuid from "../utils/uuid.ts";
import openaiCodexBody from "./openai-codex-body.ts";
import openaiCodexHeaders from "./openai-codex-headers.ts";
import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";
import type openaiCodexPrepareTypes from "./openai-codex-prepare.types.ts";
import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";
import openaiPromptCache from "./openai-prompt-cache.ts";

const { buildSSEHeaders, buildWebSocketHeaders, extractAccountId } = openaiCodexHeaders;
const { buildCodexRequestBody, codexGrammarProperties } = openaiCodexBody;
const { clampOpenAIPromptCacheKey } = openaiPromptCache;
const { callHook } = hooks;
const { encodeJsonSync } = jsonCodec;
const { uuidv7 } = uuid;

function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid timeoutMs: ${String(value)}`);
  }
  return Math.floor(value);
}

function requireApiKey({ model, options }: openaiCodexPrepareTypes.CodexRunRequest): string {
  const apiKey = options?.apiKey;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  return apiKey;
}

function startEmitter({ output, events }: openaiCodexPrepareTypes.CodexRunRequest): () => void {
  let emitted = false;
  return () => {
    if (emitted) return;
    emitted = true;
    events.push({ partial: output, type: "start" });
  };
}

const prepareCodexRun = Effect.fn("prepareCodexRun")(function* (
  request: openaiCodexPrepareTypes.CodexRunRequest,
) {
  const { model, context, options } = request;
  const token = requireApiKey(request);
  const accountId = extractAccountId(token);
  const grammarToolInputProperties = codexGrammarProperties(model)(context);
  const cacheSessionId = options?.cacheRetention === "none" ? undefined : options?.sessionId;
  const codexSessionId = clampOpenAIPromptCacheKey(cacheSessionId);
  const builtBody = buildCodexRequestBody({
    cacheSessionId: codexSessionId,
    context,
    grammarToolInputProperties,
    model,
    options,
  });
  const nextBody = yield* callHook(() => options?.onPayload?.(builtBody, model));
  const body = (nextBody ?? builtBody) as openaiCodexOptionsTypes.CodexRequestBody;
  const credentials = {
    accountId,
    modelHeaders: model.headers,
    optionHeaders: options?.headers,
    token,
  };
  return {
    ...request,
    accountId,
    body,
    bodyJson: encodeJsonSync(body),
    cacheSessionId,
    emitStart: startEmitter(request),
    grammarToolInputProperties,
    httpTimeoutMs: normalizeTimeoutMs(options?.timeoutMs),
    sseHeaders: buildSSEHeaders(credentials)(codexSessionId),
    transport: options?.transport || "auto",
    websocketConnectTimeoutMs: normalizeTimeoutMs(options?.websocketConnectTimeoutMs),
    websocketHeaders: buildWebSocketHeaders(credentials)(codexSessionId || uuidv7()),
  } satisfies openaiCodexStreamRunTypes.CodexStreamRun;
});

const openaiCodexPrepare = {
  prepareCodexRun,
};

export default openaiCodexPrepare;
