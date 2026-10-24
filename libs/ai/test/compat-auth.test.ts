import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import apiProviderRegistry from "../src/api-provider-registry.ts";
import type authTypes from "../src/auth/types.ts";
import compatStream from "../src/compat-stream.ts";
import compat from "../src/compat.ts";
import envApiKeys from "../src/env-api-keys.ts";
import modelsModule from "../src/models.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcriptModule from "../src/utils/transcript.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { complete, completeSimple, getModels, resolveAuth, stream, streamSimple } = compat;
const { compatModels } = compatStream;
const { createModels } = modelsModule;
const { registerApiProvider, unregisterApiProviders } = apiProviderRegistry;
const { testModel, testProvider } = modelsRuntimeSupport;
const { normalizeContext } = transcriptModule;
const { currentTimeMillis } = clock;
const {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
} = envApiKeys;

const mockState = vi.hoisted(() => ({
  constructorOpts: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@anthropic-ai/sdk", () => {
  const sse = [
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

  class FakeAnthropic {
    constructor(opts: Record<string, unknown>) {
      mockState.constructorOpts = opts;
    }
    beta = {
      messages: {
        create: () => ({
          asResponse: () =>
            Promise.resolve(
              new Response(sse, { headers: { "content-type": "text/event-stream" }, status: 200 }),
            ),
        }),
      },
    };
  }

  return { default: FakeAnthropic };
});

const model = getModels("anthropic-api")[0] as typesModule.Model<"anthropic-messages">;

const context = {
  messages: [{ content: "Hello", role: "user" as const, timestamp: currentTimeMillis() }],
};

const clearAnthropicEnv = Effect.sync(() => {
  for (const name of [
    ANTHROPIC_API_KEY_ENV,
    ANTHROPIC_AUTH_TOKEN_ENV,
    ANTHROPIC_FEDERATION_RULE_ID_ENV,
    ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
    ANTHROPIC_ORGANIZATION_ID_ENV,
  ]) {
    vi.stubEnv(name, undefined);
  }
});

const requestWithOnly = (env: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    yield* clearAnthropicEnv;
    const response = yield* Effect.promise(() => complete(model, context, { env }));
    expect(response.stopReason, response.errorMessage).toBe("stop");
    const sent = mockState.constructorOpts ?? {};
    const headers = (sent["defaultHeaders"] ?? {}) as Record<string, string>;
    return { apiKey: sent["apiKey"], authorization: headers["Authorization"] };
  });

afterEach(() => {
  mockState.constructorOpts = undefined;
  vi.unstubAllEnvs();
});

describe("compat stream auth", () => {
  it("sends ANTHROPIC_AUTH_TOKEN as a bearer token like the provider resolver", () =>
    Effect.runPromise(
      Effect.map(requestWithOnly({ [ANTHROPIC_AUTH_TOKEN_ENV]: "auth-token" }), (sent) =>
        expect(sent).toEqual({ apiKey: null, authorization: "Bearer auth-token" }),
      ),
    ));

  it("sends ANTHROPIC_API_KEY as the API key", () =>
    Effect.runPromise(
      Effect.map(requestWithOnly({ [ANTHROPIC_API_KEY_ENV]: "api-key" }), (sent) =>
        expect(sent).toEqual({ apiKey: "api-key", authorization: undefined }),
      ),
    ));

  it("returns an error without calling the provider when no auth resolves", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* clearAnthropicEnv;
        const responses = [
          yield* Effect.promise(() => complete(model, context, { env: {} })),
          yield* Effect.promise(() => completeSimple(model, context, { env: {} })),
        ];
        expect(
          responses.map(({ stopReason, errorMessage }) => ({ errorMessage, stopReason })),
        ).toEqual([
          { errorMessage: "Provider is not configured: anthropic-api", stopReason: "error" },
          { errorMessage: "Provider is not configured: anthropic-api", stopReason: "error" },
        ]);
        expect(mockState.constructorOpts).toBeUndefined();
      }),
    ));
});

const PROVIDER_ID = "compat-auth-test";
const CUSTOM_API = "compat-auth-custom-api";

type Call = Parameters<NonNullable<Parameters<typeof testProvider>[0]["calls"]>["push"]>[0];

const authSignals: AbortSignal[] = [];

const recordingAuth: authTypes.ApiKeyAuth = {
  name: "Recording",
  resolve: ({ signal }) => {
    authSignals.push(signal);
    return Promise.resolve({
      auth: {
        apiKey: "resolved-key",
        baseUrl: "https://auth.example.test",
        headers: { "x-auth": "auth", "x-shared": "auth" },
      },
      env: { RESOLVED_ENV: "resolved" },
    });
  },
};

const withApi = (api: typesModule.Api): typesModule.Model<typesModule.Api> => ({
  ...testModel(PROVIDER_ID, `model-${api}`),
  api,
  headers: { "x-model": "model", "x-shared": "model" },
});

const builtinApiModel = withApi("anthropic-messages");
const customApiModel = withApi(CUSTOM_API);

const recordingProvider = (calls: Call[]) =>
  testProvider({
    auth: { apiKey: recordingAuth },
    calls,
    id: PROVIDER_ID,
    models: [builtinApiModel],
  });

const requestOptions = (signal: AbortSignal) => ({
  env: { OPTION_ENV: "option" },
  headers: { "x-option": "option" },
  signal,
});

const viaModels = (target: typesModule.Model<typesModule.Api>, signal: AbortSignal) =>
  Effect.gen(function* () {
    const calls: Call[] = [];
    const models = createModels();
    models.setProvider(recordingProvider(calls));
    yield* Effect.promise(() => models.complete(target, context, requestOptions(signal)));
    yield* Effect.promise(() => models.completeSimple(target, context, requestOptions(signal)));
    return calls;
  });

const viaCompat = (target: typesModule.Model<typesModule.Api>, signal: AbortSignal) =>
  Effect.gen(function* () {
    const calls: Call[] = [];
    compatModels.setProvider(recordingProvider(calls));
    const custom = recordingProvider(calls);
    registerApiProvider(
      {
        api: CUSTOM_API,
        stream: (requested, input, options) =>
          custom.stream(
            requested,
            normalizeContext(input),
            options as typesModule.ProviderStreamOptions | undefined,
          ),
        streamSimple: (requested, input, options) =>
          custom.streamSimple(requested, normalizeContext(input), options),
      },
      PROVIDER_ID,
    );
    yield* Effect.promise(() => stream(target, context, requestOptions(signal)).result());
    yield* Effect.promise(() => streamSimple(target, context, requestOptions(signal)).result());
    return calls;
  });

const sameRequestAsModels = (target: typesModule.Model<typesModule.Api>) => {
  const { signal } = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const compatCalls = yield* viaCompat(target, signal);
      const modelsCalls = yield* viaModels(target, signal);
      expect(compatCalls.map((call) => call.options)).toEqual(
        modelsCalls.map((call) => call.options),
      );
      expect(compatCalls[0]?.options?.headers).toEqual({
        "x-auth": "auth",
        "x-model": "model",
        "x-option": "option",
        "x-shared": "model",
      });
      expect(compatCalls.map((call) => call.model.baseUrl)).toEqual([
        "https://auth.example.test",
        "https://auth.example.test",
      ]);
      expect(authSignals.slice(0, 2).every((received) => received === signal)).toBe(true);
    }),
  );
};

describe("compat stream auth goes through the Models auth path", () => {
  afterEach(() => {
    authSignals.length = 0;
    compatModels.deleteProvider(PROVIDER_ID);
    unregisterApiProviders(PROVIDER_ID);
  });

  it("builtin api: passes the signal to the resolver and adds model headers like Models", () =>
    sameRequestAsModels(builtinApiModel));

  it("registered api: passes the signal to the resolver and adds model headers like Models", () =>
    sameRequestAsModels(customApiModel));

  it("resolveAuth adds model headers and passes the signal like Models.getAuth", () => {
    const { signal } = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        compatModels.setProvider(recordingProvider([]));
        const resolved = yield* Effect.promise(() => resolveAuth(builtinApiModel, { signal }));
        expect(resolved?.auth.headers).toEqual({
          "x-auth": "auth",
          "x-model": "model",
          "x-shared": "model",
        });
        expect(authSignals.length === 1 && authSignals[0] === signal).toBe(true);
      }),
    );
  });
});
