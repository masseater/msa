import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Model } from "../src/types.ts";
import modelChoice from "./model-choice.ts";
import openaiResponsesCompatSupport from "./openai-responses-compat-support.ts";

const { chooseModel, compatValue, usesApi } = modelChoice;
const { captureResponsesRequest, proxyModel } = openaiResponsesCompatSupport;

const expectNoSessionAffinity = (
  captured: Effect.Success<ReturnType<typeof captureResponsesRequest>>,
  sessionId: string,
) => {
  expect(captured.sessionId).toBeNull();
  expect(captured.clientRequestId).toBe(sessionId);
  expect(captured.xSessionId).toBeNull();
  expect(captured.payload?.session_id).toBeUndefined();
  expect(captured.payload?.prompt_cache_key).toBe(sessionId);
};

const usesConfiguredNoSession = (provider: string) => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const captured = yield* captureResponsesRequest(
        { sessionId: "session-proxy" },
        { model: proxyModel(provider, { sessionAffinityFormat: "openai-nosession" }) },
      );
      expectNoSessionAffinity(captured, "session-proxy");
    }),
  );

const usesNoSessionForOpenCode = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel(
        "opencode",
        "no-session Responses",
        (candidate): candidate is Model<"openai-responses"> =>
          usesApi("openai-responses")(candidate) &&
          compatValue(candidate, "sessionAffinityFormat") === "openai-nosession",
      );
      const captured = yield* captureResponsesRequest({ sessionId: "session-opencode" }, { model });
      expectNoSessionAffinity(captured, "session-opencode");
    }),
  );

const explicitHeadersWin = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const captured = yield* captureResponsesRequest({
        headers: { session_id: "override-session", "x-client-request-id": "override-request" },
        sessionId: "session-123",
      });
      expect(captured.sessionId).toBe("override-session");
      expect(captured.clientRequestId).toBe("override-request");
    }),
  );

const omitsAffinityWithoutCaching = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const captured = yield* captureResponsesRequest({
        cacheRetention: "none",
        sessionId: "session-123",
      });
      expect(captured.sessionId).toBeNull();
      expect(captured.clientRequestId).toBeNull();
    }),
  );

describe("openai-responses session affinity formats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses OpenAI no-session format when configured", usesConfiguredNoSession("proxy"));
  it("uses OpenAI no-session format for OpenCode Responses models", usesNoSessionForOpenCode);
  it(
    "can omit OpenAI session_id header while preserving other affinity data",
    usesConfiguredNoSession("opencode"),
  );
  it(
    "lets explicit headers override the default OpenAI cache-affinity headers",
    explicitHeadersWin,
  );
  it(
    "omits OpenAI cache-affinity headers when cacheRetention is none",
    omitsAffinityWithoutCaching,
  );
});
