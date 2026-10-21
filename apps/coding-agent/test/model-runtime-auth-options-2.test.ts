import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import ModelRuntime from "../src/core/model-runtime.ts";
import modelRuntimeAuthSupport from "./model-runtime-auth-support.ts";
const { authOptions, testModel } = modelRuntimeAuthSupport;

const { abortController, awaited, currentTimeMillis, runTest } = testing;

const constructsAnApiKeyMethodForAn = Effect.gen(function* () {
  const runtime = yield* awaited(
    ModelRuntime.create({
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
    }),
  );
  runtime.registerProvider("extension-api-key", {
    api: "openai-completions",
    apiKey: "$EXTENSION_TEST_API_KEY",
    baseUrl: "https://example.test/v1",
    models: [testModel("extension-model")],
    name: "Extension API Key",
  });

  const options = authOptions(runtime).filter(
    (option) => option.provider.id === "extension-api-key",
  );
  expect(options).toHaveLength(1);
  expect(options[0]).toMatchObject({
    method: { name: "API key" },
    provider: { id: "extension-api-key", name: "Extension API Key" },
    type: "api_key",
  });
  expect(options[0]?.method.login).toBeTypeOf("function");
});

const resolvesConfiguredAuthFromRequestScopedEnvironment = Effect.gen(function* () {
  const runtime = yield* awaited(
    ModelRuntime.create({
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
    }),
  );
  runtime.registerProvider("request-env-provider", {
    api: "openai-completions",
    apiKey: "$REQUEST_SCOPED_API_KEY",
    baseUrl: "https://example.test/v1",
    headers: { "x-request-value": "$REQUEST_SCOPED_HEADER" },
    models: [testModel("request-env-model")],
  });

  const auth = yield* awaited(
    runtime.getAuth("request-env-provider", {
      env: { REQUEST_SCOPED_API_KEY: "request-key", REQUEST_SCOPED_HEADER: "request-header" },
    }),
  );

  expect(auth?.auth).toEqual({
    apiKey: "request-key",
    headers: { "x-request-value": "request-header" },
  });
});

const letsAnExplicitAuthorizationHeaderOverrideAuthheader = Effect.gen(function* () {
  const runtime = yield* awaited(
    ModelRuntime.create({
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
    }),
  );
  let capturedHeaders: Record<string, string | null> | undefined;
  runtime.registerProvider("auth-header-provider", {
    api: "openai-completions",
    apiKey: "generated-key",
    authHeader: true,
    baseUrl: "https://example.test/v1",
    models: [testModel("auth-header-model")],
    streamSimple: (_model, _context, options) => {
      capturedHeaders = options?.headers;
      throw new Error("captured");
    },
  });
  const model = runtime.getModel("auth-header-provider", "auth-header-model");
  expect(model).toBeDefined();

  yield* awaited(
    runtime.completeSimple(
      model!,
      { messages: [] },
      { headers: { authorization: "Explicit token" } },
    ),
  );

  expect(capturedHeaders).toEqual({ authorization: "Explicit token" });
});

const transformsFullyAssembledHeadersOnceWithoutForwardingSetup = () =>
  Effect.gen(function* () {
    const runtime = yield* awaited(
      ModelRuntime.create({
        credentials: AuthStorage.inMemory(),
        modelsPath: null,
      }),
    );
    return { runtime };
  });

const transformsFullyAssembledHeadersOnceWithoutForwarding = Effect.gen(function* () {
  const { runtime } = yield* transformsFullyAssembledHeadersOnceWithoutForwardingSetup();
  let capturedHeaders: Record<string, string | null> | undefined;
  let transforms = 0;
  runtime.registerProvider("header-provider", {
    api: "openai-completions",
    apiKey: "generated-key",
    authHeader: true,
    baseUrl: "https://example.test/v1",
    headers: { "x-provider": "provider" },
    models: [{ ...testModel("header-model"), headers: { "x-model": "model" } }],
    streamSimple: (_model, _context, options) => {
      expect(options).not.toHaveProperty("transformHeaders");
      capturedHeaders = options?.headers;
      throw new Error("captured");
    },
  });
  const model = runtime.getModel("header-provider", "header-model");
  expect(model).toBeDefined();

  yield* awaited(
    runtime.completeSimple(
      model!,
      { messages: [] },
      {
        headers: { "x-explicit": "explicit" },
        transformHeaders: (headers) => {
          transforms++;
          expect(headers).toEqual({
            Authorization: "Bearer generated-key",
            "x-explicit": "explicit",
            "x-model": "model",
            "x-provider": "provider",
          });
          return Promise.resolve({ ...headers, "x-transformed": "yes" });
        },
      },
    ),
  );

  expect(transforms).toBe(1);
  expect(capturedHeaders).toEqual({
    Authorization: "Bearer generated-key",
    "x-explicit": "explicit",
    "x-model": "model",
    "x-provider": "provider",
    "x-transformed": "yes",
  });
});

const doesNotCancelAnExtensionOauthRefresh = Effect.gen(function* () {
  const credentials = AuthStorage.inMemory({
    "extension-oauth": {
      access: "expired",
      expires: 0,
      refresh: "refresh",
      type: "oauth",
    },
  });
  const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));
  let refreshSignal: AbortSignal | undefined;
  runtime.registerProvider("extension-oauth", {
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    models: [testModel("extension-model")],
    name: "Extension OAuth",
    oauth: {
      getApiKey: (credential) => credential.access,
      login: () =>
        Promise.resolve({
          access: "access",
          expires: currentTimeMillis() + 60_000,
          refresh: "refresh",
        }),
      name: "Extension subscription",
      refreshToken: (credential, signal) => {
        refreshSignal = signal;
        return Promise.resolve({ ...credential, expires: currentTimeMillis() + 60_000 });
      },
    },
  });
  const controller = abortController();

  yield* awaited(runtime.getAuth("extension-oauth", { signal: controller.signal }));
  expect(refreshSignal).toBeInstanceOf(AbortSignal);
  const reason = new Error("cancelled");
  controller.abort(reason);

  expect(refreshSignal?.aborted).toBe(false);
});

const doesNotFabricateAnApiKeyMethod = Effect.gen(function* () {
  const runtime = yield* awaited(
    ModelRuntime.create({
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
    }),
  );
  runtime.registerProvider("extension-oauth", {
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    models: [testModel("extension-model")],
    name: "Extension OAuth",
    oauth: {
      getApiKey: (credentials) => credentials.access,
      isSubscription: true,
      login: () =>
        Promise.resolve({
          access: "access",
          expires: currentTimeMillis() + 60_000,
          refresh: "refresh",
        }),
      name: "Extension subscription",
      refreshToken: (credentials) => Promise.resolve(credentials),
    },
  });

  const options = authOptions(runtime).filter((option) => option.provider.id === "extension-oauth");
  expect(options).toHaveLength(1);
  expect(options[0]).toMatchObject({
    method: { isSubscription: true, name: "Extension subscription" },
    provider: { id: "extension-oauth", name: "Extension OAuth" },
    type: "oauth",
  });
});

describe("ModelRuntime auth options", () => {
  it("constructs an API key method for an extension API-key provider", () =>
    runTest(constructsAnApiKeyMethodForAn));

  it("resolves configured auth from request-scoped environment overrides", () =>
    runTest(resolvesConfiguredAuthFromRequestScopedEnvironment));

  it("lets an explicit Authorization header override authHeader case-insensitively", () =>
    runTest(letsAnExplicitAuthorizationHeaderOverrideAuthheader));

  it("transforms fully assembled headers once without forwarding the transform", () =>
    runTest(transformsFullyAssembledHeadersOnceWithoutForwarding));

  it("does not cancel an extension OAuth refresh with the request", () =>
    runTest(doesNotCancelAnExtensionOauthRefresh));

  it("does not fabricate an API key method for an extension OAuth-only provider", () =>
    runTest(doesNotFabricateAnApiKeyMethod));
});
