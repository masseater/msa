import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type { Tool } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { codexModel, mockToken, resetCodexStateAfterEach, runCodex, stubCodexFetch } =
  openaiCodexStreamSupport;

const sentRequest = (
  options: Parameters<typeof runCodex>[0],
  request?: Parameters<typeof runCodex>[1],
) =>
  Effect.gen(function* () {
    const { requests } = stubCodexFetch();
    const captured: { payload?: unknown } = {};
    yield* runCodex(
      {
        onPayload: (payload) => {
          captured.payload = payload;
        },
        ...options,
      },
      request,
    );
    const [sent] = requests;
    if (sent === undefined) throw new Error("Codex was not called");
    return { ...sent, payload: captured.payload as Record<string, unknown> | undefined };
  });

const sendsSessionAffinity = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { body, headers } = yield* sentRequest({ sessionId: "test-session-123" });
      expect(headers?.get("session-id")).toBe("test-session-123");
      expect(headers?.has("session_id")).toBe(false);
      expect(headers?.get("x-client-request-id")).toBe("test-session-123");
      expect(body?.["prompt_cache_key"]).toBe("test-session-123");
    }),
  );

const omitsAffinityWithoutSession = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { headers } = yield* sentRequest({});
      expect(
        ["session-id", "session_id", "x-client-request-id"].map((name) => headers?.has(name)),
      ).toEqual([false, false, false]);
    }),
  );

const omitsAffinityWithoutCaching = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { body, headers } = yield* sentRequest({
        cacheRetention: "none",
        sessionId: "one-off-summary",
      });
      expect(headers?.has("session-id")).toBe(false);
      expect(headers?.has("x-client-request-id")).toBe(false);
      expect(body).not.toHaveProperty("prompt_cache_key");
    }),
  );

const clampsSessionIdentifiers = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { headers, payload } = yield* sentRequest({ sessionId: "x".repeat(67) });
      expect(payload?.["prompt_cache_key"]).toBe("x".repeat(64));
      expect(headers?.get("session-id")).toBe("x".repeat(64));
      expect(headers?.get("x-client-request-id")).toBe("x".repeat(64));
    }),
  );

const callerHeadersWin = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const token = mockToken();
      const { headers } = yield* sentRequest(
        { apiKey: token, headers: { Authorization: "Bearer ignored", "user-agent": "my-app/1.0" } },
        { model: codexModel({ headers: { originator: "my-app" } }) },
      );
      expect(headers?.get("originator")).toBe("my-app");
      expect(headers?.get("User-Agent")).toBe("my-app/1.0");
      expect(headers?.get("Authorization")).toBe(`Bearer ${token}`);
    }),
  );

const toolContext = (tools: Tool[]) =>
  normalizeContext({ messages: [{ content: "Use a tool", role: "user", timestamp: 1 }], tools });

const forwardsRequiredToolChoice = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { body } = yield* sentRequest(
        { toolChoice: "required" } as Parameters<typeof runCodex>[0],
        {
          context: toolContext([
            {
              description: "Ping",
              name: "ping",
              parameters: Type.Object({ value: Type.String() }),
            },
          ]),
        },
      );
      expect(body?.["tool_choice"]).toBe("required");
    }),
  );

const setsStrictModeExplicitly = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* sentRequest(
        {},
        {
          context: toolContext([
            {
              constrainedSampling: false,
              description: "Optional constrained sampling",
              name: "optional",
              parameters: Type.Object({ value: Type.String() }),
            },
            {
              constrainedSampling: { strict: "prefer", type: "json_schema" },
              description: "Strict constrained sampling",
              name: "strict",
              parameters: Type.Object({ value: Type.String() }, { additionalProperties: false }),
            },
          ]),
        },
      );
      expect(payload?.["tools"]).toMatchObject([
        { name: "optional", strict: null, type: "function" },
        { name: "strict", strict: true, type: "function" },
      ]);
    }),
  );

describe("openai-codex request headers and payload", () => {
  resetCodexStateAfterEach();

  it(
    "sets session-id/x-client-request-id headers and prompt_cache_key when sessionId is provided",
    sendsSessionAffinity,
  );
  it(
    "does not set session-id/x-client-request-id headers when sessionId is not provided",
    omitsAffinityWithoutSession,
  );
  it("omits SSE cache affinity when cacheRetention is none", omitsAffinityWithoutCaching);
  it(
    "clamps prompt_cache_key and the session-id header to 64 characters",
    clampsSessionIdentifiers,
  );
  it("lets model and caller headers override originator and User-Agent", callerHeadersWin);
  it("forwards required tool choice", forwardsRequiredToolChoice);
  it("sets Codex strict mode explicitly and honors constrained sampling", setsStrictModeExplicitly);
});
