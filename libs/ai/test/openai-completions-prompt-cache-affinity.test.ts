import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import modelChoice from "./model-choice.ts";
import openaiCompletionsPromptCacheSupport from "./openai-completions-prompt-cache-support.ts";

vi.mock("openai", () =>
  import("./openai-completions-prompt-cache-mock.ts").then((module) => module.default),
);

const { chooseModel, usesApi } = modelChoice;
const { captureRequest, createModel, isolateCacheRetentionEnv } =
  openaiCompletionsPromptCacheSupport;

const proxyModel = createModel({
  baseUrl: "https://proxy.example.com/v1",
  compat: { sendSessionAffinityHeaders: true },
});

const sendsKnownSessionAffinityHeadersWhen = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { headers } = yield* captureRequest({ sessionId: "session-affinity" }, proxyModel);
      expect(headers["session_id"]).toBe("session-affinity");
      expect(headers["x-client-request-id"]).toBe("session-affinity");
      expect(headers["x-session-affinity"]).toBe("session-affinity");
    }),
  );

const usesOpenAINoSessionFormatWhen = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel({
        compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: "openai-nosession" },
      });
      const { headers, payload } = yield* captureRequest({ sessionId: "session-nosession" }, model);
      expect(payload?.session_id).toBeUndefined();
      expect(payload?.prompt_cache_key).toBe("session-nosession");
      expect(headers["session_id"]).toBeUndefined();
      expect(headers["x-client-request-id"]).toBe("session-nosession");
      expect(headers["x-session-affinity"]).toBe("session-nosession");
      expect(headers["x-session-id"]).toBeUndefined();
    }),
  );

const usesOpenRouterSessionAffinityHeaderWhen = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel({
        baseUrl: "https://proxy.example.com/v1",
        compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: "openrouter" },
      });
      const { headers, payload } = yield* captureRequest({ sessionId: "session-proxy" }, model);
      expect(payload?.session_id).toBeUndefined();
      expect(payload?.prompt_cache_key).toBeUndefined();
      expect(headers["x-session-id"]).toBe("session-proxy");
      expect(headers["session_id"]).toBeUndefined();
      expect(headers["x-client-request-id"]).toBeUndefined();
      expect(headers["x-session-affinity"]).toBeUndefined();
    }),
  );

const sendsOpenRouterSessionAffinityHeaderBy = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel("openrouter", "completions", usesApi("openai-completions"));
      const { headers, payload } = yield* captureRequest(
        { sessionId: "session-openrouter" },
        model,
      );
      expect(payload?.session_id).toBeUndefined();
      expect(payload?.prompt_cache_key).toBeUndefined();
      expect(headers["x-session-id"]).toBe("session-openrouter");
      expect(headers["session_id"]).toBeUndefined();
      expect(headers["x-client-request-id"]).toBeUndefined();
      expect(headers["x-session-affinity"]).toBeUndefined();
    }),
  );

const omitsOpenRouterSessionAffinityDataWhen = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel({
        baseUrl: "https://openrouter.ai/api/v1",
        compat: { sendSessionAffinityHeaders: false },
        provider: "openrouter",
      });
      const { headers, payload } = yield* captureRequest(
        { sessionId: "session-openrouter" },
        model,
      );
      expect(payload?.session_id).toBeUndefined();
      expect(payload?.prompt_cache_key).toBeUndefined();
      expect(headers["x-session-id"]).toBeUndefined();
    }),
  );

const omitsSessionAffinityHeadersWhenCacheRetention = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { headers } = yield* captureRequest(
        { cacheRetention: "none", sessionId: "session-affinity" },
        proxyModel,
      );
      expect(headers["session_id"]).toBeUndefined();
      expect(headers["x-client-request-id"]).toBeUndefined();
      expect(headers["x-session-affinity"]).toBeUndefined();
    }),
  );

const letsExplicitHeadersOverrideGeneratedSession = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { headers } = yield* captureRequest(
        {
          headers: {
            session_id: "override-session",
            "x-client-request-id": "override-request",
            "x-session-affinity": "override-affinity",
          },
          sessionId: "session-affinity",
        },
        proxyModel,
      );
      expect(headers["session_id"]).toBe("override-session");
      expect(headers["x-client-request-id"]).toBe("override-request");
      expect(headers["x-session-affinity"]).toBe("override-affinity");
    }),
  );

describe("openai-completions session affinity", () => {
  isolateCacheRetentionEnv();

  it(
    "sends known session-affinity headers when compat.sendSessionAffinityHeaders is enabled",
    sendsKnownSessionAffinityHeadersWhen,
  );

  it("uses OpenAI no-session format when configured", usesOpenAINoSessionFormatWhen);

  it(
    "uses OpenRouter session-affinity header when configured",
    usesOpenRouterSessionAffinityHeaderWhen,
  );

  it(
    "sends OpenRouter session-affinity header by default for built-in OpenRouter models",
    sendsOpenRouterSessionAffinityHeaderBy,
  );

  it(
    "omits OpenRouter session-affinity data when disabled",
    omitsOpenRouterSessionAffinityDataWhen,
  );

  it(
    "omits session-affinity headers when cacheRetention is none",
    omitsSessionAffinityHeadersWhenCacheRetention,
  );

  it(
    "lets explicit headers override generated session-affinity headers",
    letsExplicitHeadersOverrideGeneratedSession,
  );
});
