import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import modelsModule from "../src/models.ts";
import anthropic from "../src/providers/anthropic.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;
const { currentTimeMillis } = clock;
const { anthropicProvider } = anthropic;
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
        message: { id: "msg_test", usage: { input_tokens: 1, output_tokens: 0 } },
        type: "message_start",
      })}\n`,
      `event: message_delta\ndata: ${JSON.stringify({
        delta: { stop_reason: "end_turn" },
        type: "message_delta",
        usage: { output_tokens: 1 },
      })}\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n`,
    ].join("\n");
    return new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 });
  }

  class FakeAnthropic {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      mockState.constructorOpts = opts;
    }
    withOptions(options: Record<string, unknown>) {
      return new FakeAnthropic({ ...this.opts, ...options });
    }
    beta = {
      messages: {
        create: (params: Record<string, unknown>) => {
          mockState.createParams = params;
          return { asResponse: () => Promise.resolve(createSseResponse()) };
        },
      },
    };
  }

  return { default: FakeAnthropic };
});

const neverAbortedSignal = new AbortController().signal;

const federationEnv = {
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_test",
  ANTHROPIC_IDENTITY_TOKEN_FILE: "/tmp/identity.jwt",
  ANTHROPIC_ORGANIZATION_ID: "org-test",
  ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_test",
};

const expectedConfig = {
  authentication: {
    federation_rule_id: "fdrl_test",
    identity_token: { path: "/tmp/identity.jwt", source: "file" },
    service_account_id: "svac_test",
    type: "oidc_federation",
  },
  organization_id: "org-test",
  workspace_id: undefined,
};

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

function resolveWithEnv(env: Record<string, string>) {
  return anthropicProvider().auth.apiKey?.resolve({
    ctx: { env: (name) => Promise.resolve(env[name]), fileExists: () => Promise.resolve(false) },
    signal: neverAbortedSignal,
  });
}

afterEach(() => {
  mockState.constructorOpts = undefined;
  mockState.createParams = undefined;
});

describe("Anthropic workload identity federation", () => {
  it("resolves the federation variables as provider env with no request auth", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* Effect.promise(() => Promise.resolve(resolveWithEnv(federationEnv)))).toEqual(
          {
            auth: {},
            env: federationEnv,
            source: "workload identity federation",
          },
        );
      }),
    ));

  it("passes ANTHROPIC_WORKSPACE_ID through when set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          Promise.resolve(
            resolveWithEnv({
              ...federationEnv,
              ANTHROPIC_WORKSPACE_ID: "wrkspc_test",
            }),
          ),
        );
        expect(result?.env?.["ANTHROPIC_WORKSPACE_ID"]).toBe("wrkspc_test");
      }),
    ));

  it("is not configured when a federation variable is missing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { ANTHROPIC_IDENTITY_TOKEN_FILE: _omitted, ...partial } = federationEnv;
        expect(
          yield* Effect.promise(() => Promise.resolve(resolveWithEnv(partial))),
        ).toBeUndefined();
      }),
    ));
});

describe("Anthropic workload identity federation", () => {
  it("treats ANTHROPIC_SERVICE_ACCOUNT_ID as optional, like the SDK", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { ANTHROPIC_SERVICE_ACCOUNT_ID: _omitted, ...partial } = federationEnv;
        expect(yield* Effect.promise(() => Promise.resolve(resolveWithEnv(partial)))).toEqual({
          auth: {},
          env: partial,
          source: "workload identity federation",
        });

        yield* Effect.promise(() =>
          streamAnthropic(anthropicModel, context, { env: partial }).result(),
        );
        expect(mockState.constructorOpts?.["config"]).toEqual({
          ...expectedConfig,
          authentication: { ...expectedConfig.authentication, service_account_id: undefined },
        });
      }),
    ));

  it("keeps API key and auth token precedence over federation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(
          yield* Effect.promise(() =>
            Promise.resolve(resolveWithEnv({ ...federationEnv, ANTHROPIC_API_KEY: "api-key" })),
          ),
        ).toEqual({
          auth: { apiKey: "api-key" },
          source: "ANTHROPIC_API_KEY",
        });
        expect(
          yield* Effect.promise(() =>
            Promise.resolve(
              resolveWithEnv({ ...federationEnv, ANTHROPIC_AUTH_TOKEN: "auth-token" }),
            ),
          ),
        ).toEqual({
          auth: { headers: { Authorization: "Bearer auth-token" } },
          source: "ANTHROPIC_AUTH_TOKEN",
        });
      }),
    ));
});

describe("Anthropic workload identity federation", () => {
  it("hands the SDK a federation config instead of a key", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          streamAnthropic(anthropicModel, context, { env: federationEnv }).result(),
        );

        expect(mockState.constructorOpts?.["apiKey"]).toBeNull();
        expect(mockState.constructorOpts?.["authToken"]).toBeNull();
        expect(mockState.constructorOpts?.["config"]).toEqual(expectedConfig);
        const headers = mockState.constructorOpts?.["defaultHeaders"] as Record<
          string,
          string | null
        >;
        expect(headers["Authorization"]).toBeUndefined();
      }),
    ));

  it("threads authContext federation variables through Models", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = createModels({
          authContext: {
            env: (name) => Promise.resolve(federationEnv[name as keyof typeof federationEnv]),
            fileExists: () => Promise.resolve(false),
          },
        });
        models.setProvider(anthropicProvider());

        yield* Effect.promise(() => models.streamSimple(anthropicModel, context).result());

        expect(mockState.constructorOpts?.["apiKey"]).toBeNull();
        expect(mockState.constructorOpts?.["config"]).toEqual(expectedConfig);
      }),
    ));
});

describe("Anthropic workload identity federation", () => {
  it("lets an explicit API key win over federation env", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          streamAnthropic(anthropicModel, context, {
            apiKey: "explicit-key",
            env: federationEnv,
          }).result(),
        );

        expect(mockState.constructorOpts?.["apiKey"]).toBe("explicit-key");
        expect(mockState.constructorOpts?.["config"]).toBeUndefined();
      }),
    ));

  it("does not federate other anthropic-messages providers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const custom: typesModule.Model<"anthropic-messages"> = {
          ...anthropicModel,
          baseUrl: "https://example.test/anthropic",
          provider: "custom",
        };
        const message = yield* Effect.promise(() =>
          streamAnthropic(custom, context, { env: federationEnv }).result(),
        );

        expect(message.stopReason).toBe("error");
        expect(mockState.constructorOpts).toBeUndefined();
      }),
    ));
});
