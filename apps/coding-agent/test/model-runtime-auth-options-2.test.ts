import { abortController, awaited, currentTimeMillis, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { authOptions, testModel } from "./model-runtime-auth-support.ts";

describe("ModelRuntime auth options", () => {
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
          api: "openai-completions",
          models: [testModel("extension-model")],
        });

        const options = authOptions(runtime).filter(
          (option) => option.provider.id === "extension-api-key",
        );
        expect(options).toHaveLength(1);
        expect(options[0]).toMatchObject({
          type: "api_key",
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
          api: "openai-completions",
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
          api: "openai-completions",
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
          api: "openai-completions",
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
              transformHeaders: (headers) => {
                transforms++;
                expect(headers).toEqual({
                  Authorization: "Bearer generated-key",
                  "x-provider": "provider",
                  "x-model": "model",
                  "x-explicit": "explicit",
                });
                return Promise.resolve({ ...headers, "x-transformed": "yes" });
              },
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
        const credentials = AuthStorage.inMemory({
          "extension-oauth": {
            type: "oauth",
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
          api: "openai-completions",
          oauth: {
            name: "Extension subscription",
            login: () =>
              Promise.resolve({
                access: "access",
                refresh: "refresh",
                expires: currentTimeMillis() + 60_000,
              }),
            refreshToken: (credential, signal) => {
              refreshSignal = signal;
              return Promise.resolve({ ...credential, expires: currentTimeMillis() + 60_000 });
            },
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
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory(),
            modelsPath: null,
          }),
        );
        runtime.registerProvider("extension-oauth", {
          name: "Extension OAuth",
          baseUrl: "https://example.test/v1",
          api: "openai-completions",
          oauth: {
            name: "Extension subscription",
            isSubscription: true,
            login: () =>
              Promise.resolve({
                access: "access",
                refresh: "refresh",
                expires: currentTimeMillis() + 60_000,
              }),
            refreshToken: (credentials) => Promise.resolve(credentials),
            getApiKey: (credentials) => credentials.access,
          },
          models: [testModel("extension-model")],
        });

        const options = authOptions(runtime).filter(
          (option) => option.provider.id === "extension-oauth",
        );
        expect(options).toHaveLength(1);
        expect(options[0]).toMatchObject({
          type: "oauth",
          provider: { id: "extension-oauth", name: "Extension OAuth" },
          method: { name: "Extension subscription", isSubscription: true },
        });
      }),
    ));
});
