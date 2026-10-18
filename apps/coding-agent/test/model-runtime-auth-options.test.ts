import { type AuthType, type CredentialStore, InMemoryCredentialStore } from "@msa/ai";
import { awaited, runTest, currentTimeMillis, abortController } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

function authOptions(runtime: ModelRuntime, type?: AuthType) {
  return runtime
    .getProviders()
    .flatMap((provider) => [
      ...(!type || type === "oauth"
        ? provider.auth.oauth
          ? [{ type: "oauth" as const, provider, method: provider.auth.oauth }]
          : []
        : []),
      ...(!type || type === "api_key"
        ? provider.auth.apiKey
          ? [{ type: "api_key" as const, provider, method: provider.auth.apiKey }]
          : []
        : []),
    ]);
}

function testModel(id: string) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10000,
    maxTokens: 1000,
  };
}

describe("ModelRuntime auth options", () => {
  it("accepts a msa-ai CredentialStore", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const credentials = new InMemoryCredentialStore();
        yield* awaited(
          credentials.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "stored-key" })),
          ),
        );
        const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));

        expect((yield* awaited(runtime.getAuth("anthropic")))?.auth.apiKey).toBe("stored-key");
      }),
    ));

  it("scopes provider availability reads and records refresh failures", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const base = new InMemoryCredentialStore();
        const reads: string[] = [];
        let failReads = false;
        const credentials: CredentialStore = {
          read: (providerId) =>
            effectRunPromise(
              Effect.gen(function* () {
                reads.push(providerId);
                if (failReads) throw new Error(`read failed for ${providerId}`);
                return yield* awaited(base.read(providerId));
              }),
            ),
          list: () => base.list(),
          modify: (providerId, fn) => base.modify(providerId, fn),
          delete: (providerId) => base.delete(providerId),
        };
        const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));

        reads.length = 0;
        yield* awaited(runtime.getAvailable("anthropic"));
        expect(new Set(reads)).toEqual(new Set(["anthropic"]));

        failReads = true;
        yield* awaited(
          expect(runtime.getAvailable("anthropic")).rejects.toThrow(
            "Credential store read failed for anthropic",
          ),
        );
        expect(runtime.getError()).toContain(
          "Availability refresh: Credential store read failed for anthropic",
        );

        failReads = false;
        yield* awaited(runtime.getAvailable());
        expect(runtime.getError()).toBeUndefined();
      }),
    ));

  it("projects provider-owned methods, names, and status", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        const options = authOptions(runtime);

        expect(options).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "api_key" as const,
              provider: expect.objectContaining({ id: "openrouter", name: "OpenRouter" }),
              method: expect.objectContaining({ name: "OpenRouter API key" }),
            }),
            expect.objectContaining({
              type: "oauth" as const,
              provider: expect.objectContaining({ id: "anthropic", name: "Anthropic" }),
            }),
          ]),
        );
        expect(authOptions(runtime, "api_key").every((option) => option.type === "api_key")).toBe(
          true,
        );
        expect(authOptions(runtime, "oauth").every((option) => option.type === "oauth")).toBe(true);
        expect(
          options.some(
            (option) => option.provider.id === "openai-codex" && option.type === "api_key",
          ),
        ).toBe(false);
      }),
    ));

  it("attaches the provider's active auth status to every method option", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory({
              anthropic: {
                type: "oauth" as const,
                access: "access",
                refresh: "refresh",
                expires: currentTimeMillis() + 60_000,
              },
            }),
            modelsPath: null,
          }),
        );

        const options = authOptions(runtime).filter((option) => option.provider.id === "anthropic");
        expect(options).toHaveLength(2);
        expect(yield* awaited(runtime.checkAuth("anthropic"))).toMatchObject({
          type: "oauth" as const,
        });
      }),
    ));

  it("distinguishes subscription OAuth from generic OAuth sign-in", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory({
              anthropic: {
                type: "oauth" as const,
                access: "anthropic-access",
                refresh: "anthropic-refresh",
                expires: currentTimeMillis() + 60 * 60_000,
              },
              openrouter: {
                type: "oauth" as const,
                access: "openrouter-key",
                refresh: "",
                expires: Number.MAX_SAFE_INTEGER,
              },
            }),
            modelsPath: null,
          }),
        );

        expect(runtime.isUsingOAuth("anthropic")).toBe(true);
        expect(runtime.isUsingSubscription("anthropic")).toBe(true);
        expect(runtime.isUsingOAuth("openrouter")).toBe(true);
        expect(runtime.isUsingSubscription("openrouter")).toBe(false);
      }),
    ));

  it("constructs an API key method for an extension API-key provider", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        runtime.registerProvider("extension-api-key", {
          name: "Extension API Key",
          baseUrl: "https://example.test/v1",
          apiKey: "$EXTENSION_TEST_API_KEY",
          api: "openai-completions" as const,
          models: [testModel("extension-model")],
        });

        const options = authOptions(runtime).filter(
          (option) => option.provider.id === "extension-api-key",
        );
        expect(options).toHaveLength(1);
        expect(options[0]).toMatchObject({
          type: "api_key" as const,
          provider: { id: "extension-api-key", name: "Extension API Key" },
          method: { name: "API key" },
        });
        expect(options[0]?.method.login).toBeTypeOf("function");
      }),
    ));

  it("resolves configured auth from request-scoped environment overrides", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        runtime.registerProvider("request-env-provider", {
          baseUrl: "https://example.test/v1",
          apiKey: "$REQUEST_SCOPED_API_KEY",
          headers: { "x-request-value": "$REQUEST_SCOPED_HEADER" },
          api: "openai-completions" as const,
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
      }),
    ));

  it("lets an explicit Authorization header override authHeader case-insensitively", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        let capturedHeaders: Record<string, string | null> | undefined;
        runtime.registerProvider("auth-header-provider", {
          baseUrl: "https://example.test/v1",
          apiKey: "generated-key",
          authHeader: true,
          api: "openai-completions" as const,
          streamSimple: (_model, _context, options) => {
            capturedHeaders = options?.headers;
            throw new Error("captured");
          },
          models: [testModel("auth-header-model")],
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
      }),
    ));

  it("transforms fully assembled headers once without forwarding the transform", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        let capturedHeaders: Record<string, string | null> | undefined;
        let transforms = 0;
        runtime.registerProvider("header-provider", {
          baseUrl: "https://example.test/v1",
          apiKey: "generated-key",
          authHeader: true,
          headers: { "x-provider": "provider" },
          api: "openai-completions" as const,
          streamSimple: (_model, _context, options) => {
            expect(options).not.toHaveProperty("transformHeaders");
            capturedHeaders = options?.headers;
            throw new Error("captured");
          },
          models: [{ ...testModel("header-model"), headers: { "x-model": "model" } }],
        });
        const model = runtime.getModel("header-provider", "header-model");
        expect(model).toBeDefined();

        yield* awaited(
          runtime.completeSimple(
            model!,
            { messages: [] },
            {
              headers: { "x-explicit": "explicit" },
              transformHeaders: (headers) =>
                effectRunPromise(
                  Effect.gen(function* () {
                    transforms++;
                    expect(headers).toEqual({
                      Authorization: "Bearer generated-key",
                      "x-provider": "provider",
                      "x-model": "model",
                      "x-explicit": "explicit",
                    });
                    return yield* awaited({ ...headers, "x-transformed": "yes" });
                  }),
                ),
            },
          ),
        );

        expect(transforms).toBe(1);
        expect(capturedHeaders).toEqual({
          Authorization: "Bearer generated-key",
          "x-provider": "provider",
          "x-model": "model",
          "x-explicit": "explicit",
          "x-transformed": "yes",
        });
      }),
    ));

  it("does not cancel an extension OAuth refresh with the request", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const credentials = AuthStorage.inMemory({
          "extension-oauth": {
            type: "oauth" as const,
            access: "expired",
            refresh: "refresh",
            expires: 0,
          },
        });
        const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));
        let refreshSignal: AbortSignal | undefined;
        runtime.registerProvider("extension-oauth", {
          name: "Extension OAuth",
          baseUrl: "https://example.test/v1",
          api: "openai-completions" as const,
          oauth: {
            name: "Extension subscription",
            login: () =>
              effectRunPromise(
                awaited({
                  access: "access",
                  refresh: "refresh",
                  expires: currentTimeMillis() + 60_000,
                }),
              ),
            refreshToken: (credential, signal) =>
              effectRunPromise(
                Effect.gen(function* () {
                  refreshSignal = signal;
                  return yield* awaited({ ...credential, expires: currentTimeMillis() + 60_000 });
                }),
              ),
            getApiKey: (credential) => credential.access,
          },
          models: [testModel("extension-model")],
        });
        const controller = abortController();

        yield* awaited(runtime.getAuth("extension-oauth", { signal: controller.signal }));
        expect(refreshSignal).toBeInstanceOf(AbortSignal);
        const reason = new Error("cancelled");
        controller.abort(reason);

        expect(refreshSignal?.aborted).toBe(false);
      }),
    ));

  it("does not fabricate an API key method for an extension OAuth-only provider", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        runtime.registerProvider("extension-oauth", {
          name: "Extension OAuth",
          baseUrl: "https://example.test/v1",
          api: "openai-completions" as const,
          oauth: {
            name: "Extension subscription",
            isSubscription: true,
            login: () =>
              effectRunPromise(
                awaited({
                  access: "access",
                  refresh: "refresh",
                  expires: currentTimeMillis() + 60_000,
                }),
              ),
            refreshToken: (credentials) => effectRunPromise(awaited(credentials)),
            getApiKey: (credentials) => credentials.access,
          },
          models: [testModel("extension-model")],
        });

        const options = authOptions(runtime).filter(
          (option) => option.provider.id === "extension-oauth",
        );
        expect(options).toHaveLength(1);
        expect(options[0]).toMatchObject({
          type: "oauth" as const,
          provider: { id: "extension-oauth", name: "Extension OAuth" },
          method: { name: "Extension subscription", isSubscription: true },
        });
      }),
    ));
});
