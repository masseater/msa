import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import openaiResponsesCompatSupport from "./openai-responses-compat-support.ts";

const { captureResponsesRequest, proxyModel } = openaiResponsesCompatSupport;

const setsOfficialAffinityHeaders = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const captured = yield* captureResponsesRequest({ sessionId: "session-123" });
      expect(captured.sessionId).toBe("session-123");
      expect(captured.clientRequestId).toBe("session-123");
    }),
  );

const clampsPromptCacheKey = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* captureResponsesRequest({ sessionId: "x".repeat(67) });
      expect(payload?.prompt_cache_key).toBe("x".repeat(64));
    }),
  );

const setsProxyAffinityHeaders = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const captured = yield* captureResponsesRequest(
        { sessionId: "session-123" },
        { model: proxyModel("opencode") },
      );
      expect(captured.sessionId).toBe("session-123");
      expect(captured.clientRequestId).toBe("session-123");
    }),
  );

const expectOpenRouterAffinity = (
  captured: Effect.Success<ReturnType<typeof captureResponsesRequest>>,
  sessionId: string,
) => {
  expect(captured.sessionId).toBeNull();
  expect(captured.clientRequestId).toBeNull();
  expect(captured.xSessionId).toBe(sessionId);
  expect(captured.payload?.session_id).toBeUndefined();
  expect(captured.payload?.prompt_cache_key).toBe(sessionId);
};

const usesConfiguredOpenRouterAffinity = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const captured = yield* captureResponsesRequest(
        { sessionId: "session-proxy" },
        { model: proxyModel("proxy", { sessionAffinityFormat: "openrouter" }) },
      );
      expectOpenRouterAffinity(captured, "session-proxy");
    }),
  );

const detectsOpenRouterAffinity = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const captured = yield* captureResponsesRequest(
        { sessionId: "session-openrouter" },
        { model: proxyModel("openrouter", undefined, "https://openrouter.ai/api/v1") },
      );
      expectOpenRouterAffinity(captured, "session-openrouter");
    }),
  );

describe("openai-responses session affinity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "sets cache-affinity headers for official OpenAI Responses requests with a sessionId",
    setsOfficialAffinityHeaders,
  );
  it("clamps prompt_cache_key to OpenAI's 64-character limit", clampsPromptCacheKey);
  it(
    "sets cache-affinity headers for proxy OpenAI Responses requests with a sessionId",
    setsProxyAffinityHeaders,
  );
  it("uses OpenRouter session-affinity header when configured", usesConfiguredOpenRouterAffinity);
  it(
    "auto-detects OpenRouter session-affinity header for OpenRouter Responses endpoints",
    detectsOpenRouterAffinity,
  );
});
