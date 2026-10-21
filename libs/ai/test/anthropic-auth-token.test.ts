import { arch, platform } from "node:os";

import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import envApiKeys from "../src/env-api-keys.ts";
import modelsModule from "../src/models.ts";
import anthropic from "../src/providers/anthropic.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;
const { currentTimeMillis } = clock;
const { anthropicProvider } = anthropic;
const { ANTHROPIC_AUTH_TOKEN_ENV } = envApiKeys;
const { stream: streamAnthropic } = anthropicMessages;
const { createModels } = modelsModule;

const mockState = vi.hoisted(() => ({
  constructorOpts: undefined as Record<string, unknown> | undefined,
  createParams: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@anthropic-ai/sdk", () => {
  function createSseResponse(): Response {
    const body = [
      `event: message_start\ndata: ${JSON.stringify({
        message: {
          id: "msg_test",
          usage: { input_tokens: 1, output_tokens: 0 },
        },
        type: "message_start",
      })}\n`,
      `event: message_delta\ndata: ${JSON.stringify({
        delta: { stop_reason: "end_turn" },
        type: "message_delta",
        usage: { output_tokens: 1 },
      })}\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n`,
    ].join("\n");

    return new Response(body, {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    });
  }

  class FakeAnthropic {
    constructor(opts: Record<string, unknown>) {
      mockState.constructorOpts = opts;
    }
    beta = {
      messages: {
        create: (params: Record<string, unknown>) => {
          mockState.createParams = params;
          return {
            asResponse: () => Promise.resolve(createSseResponse()),
          };
        },
      },
    };
  }

  return { default: FakeAnthropic };
});

const MSA_USER_AGENT = `pi (${platform()}; ${arch()})`;
const neverAbortedSignal = new AbortController().signal;

const context = normalizeContext({
  messages: [{ content: "Hello", role: "user", timestamp: currentTimeMillis() }],
  systemPrompt: "System prompt.",
});

const anthropicModel: typesModule.Model<"anthropic-messages"> = {
  api: "anthropic-messages",
  baseUrl: "https://api.anthropic.com",
  contextWindow: 100000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "claude-test",
  input: ["text"],
  maxTokens: 4096,
  name: "Claude Test",
  provider: "anthropic-api",
  reasoning: false,
};

const compatibleModel: typesModule.Model<"anthropic-messages"> = {
  ...anthropicModel,
  baseUrl: "https://example.test/anthropic",
  id: "custom-model",
  name: "Custom Model",
  provider: "custom",
};

afterEach(() => {
  mockState.constructorOpts = undefined;
  mockState.createParams = undefined;
});

describe("Anthropic auth token env", () => {
  it("resolves ANTHROPIC_AUTH_TOKEN as a bearer Authorization header", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = anthropicProvider();
        const auth = yield* Effect.promise(() =>
          Promise.resolve(
            provider.auth.apiKey?.resolve({
              ctx: {
                env: (name) =>
                  Promise.resolve(
                    {
                      ANTHROPIC_API_KEY: "api-key",
                      ANTHROPIC_AUTH_TOKEN: "auth-token",
                    }[name],
                  ),
                fileExists: () => Promise.resolve(false),
              },
              signal: neverAbortedSignal,
            }),
          ),
        );

        expect(auth).toEqual({
          auth: { headers: { Authorization: "Bearer auth-token" } },
          source: ANTHROPIC_AUTH_TOKEN_ENV,
        });
      }),
    ));
});

describe("Anthropic auth token env", () => {
  it("uses Authorization headers without OAuth-mode request shaping", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = streamAnthropic(anthropicModel, context, {
          headers: { Authorization: "Bearer gateway-token" },
        });
        yield* Effect.promise(() => stream.result());

        expect(mockState.constructorOpts?.["apiKey"]).toBeNull();
        expect(mockState.constructorOpts?.["authToken"]).toBeNull();
        const headers = mockState.constructorOpts?.["defaultHeaders"] as Record<
          string,
          string | null
        >;
        expect(headers["Authorization"]).toBe("Bearer gateway-token");
        expect(mockState.createParams?.["system"]).toEqual([
          expect.objectContaining({ text: "System prompt." }),
        ]);
      }),
    ));

  it("threads authContext ANTHROPIC_AUTH_TOKEN through request headers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = createModels({
          authContext: {
            env: (name) =>
              Promise.resolve(name === "ANTHROPIC_AUTH_TOKEN" ? "ctx-token" : undefined),
            fileExists: () => Promise.resolve(false),
          },
        });
        models.setProvider(anthropicProvider());

        yield* Effect.promise(() => models.streamSimple(anthropicModel, context).result());

        expect(mockState.constructorOpts?.["apiKey"]).toBeNull();
        expect(mockState.constructorOpts?.["authToken"]).toBeNull();
        const headers = mockState.constructorOpts?.["defaultHeaders"] as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer ctx-token");
        expect(mockState.createParams?.["system"]).toEqual([
          expect.objectContaining({ text: "System prompt." }),
        ]);
      }),
    ));
});

describe("Anthropic auth token env", () => {
  it("lets explicit request headers override ANTHROPIC_AUTH_TOKEN", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = createModels({
          authContext: {
            env: (name) =>
              Promise.resolve(name === "ANTHROPIC_AUTH_TOKEN" ? "ctx-token" : undefined),
            fileExists: () => Promise.resolve(false),
          },
        });
        models.setProvider(anthropicProvider());

        yield* Effect.promise(() =>
          models
            .streamSimple(anthropicModel, context, {
              headers: { Authorization: "Bearer explicit-token" },
            })
            .result(),
        );

        const headers = mockState.constructorOpts?.["defaultHeaders"] as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer explicit-token");
      }),
    ));
});

describe("Anthropic-compatible user agents", () => {
  it("uses msa's User-Agent by default for Anthropic Messages requests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          streamAnthropic(anthropicModel, context, { apiKey: "anthropic-key" }).result(),
        );

        const headers = mockState.constructorOpts?.["defaultHeaders"] as Record<string, string>;
        expect(headers["User-Agent"]).toBe(MSA_USER_AGENT);
      }),
    ));

  it("lets explicit headers override the default Anthropic Messages User-Agent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          streamAnthropic(compatibleModel, context, {
            apiKey: "custom-key",
            headers: { "User-Agent": "custom-client" },
          }).result(),
        );

        const headers = mockState.constructorOpts?.["defaultHeaders"] as Record<string, string>;
        expect(headers["User-Agent"]).toBe("custom-client");
      }),
    ));

  it("preserves explicit Anthropic beta header replacement", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          streamAnthropic(anthropicModel, context, {
            apiKey: "anthropic-key",
            headers: { "anthropic-beta": "custom-beta" },
          }).result(),
        );

        expect(mockState.createParams?.["betas"]).toEqual(["custom-beta"]);
      }),
    ));
});

describe("Anthropic-compatible user agents", () => {
  it("preserves explicit Anthropic beta header suppression", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          streamAnthropic(anthropicModel, context, {
            apiKey: "anthropic-key",
            headers: { "anthropic-beta": null },
          }).result(),
        );

        expect(mockState.createParams?.["betas"]).toBeUndefined();
      }),
    ));
});
