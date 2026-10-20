import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import modelRuntimeAuthSupport from "./model-runtime-auth-support.ts";

const { InMemoryCredentialStore } = ai;

const { authOptions } = modelRuntimeAuthSupport;

const { awaited, currentTimeMillis, failure, runTest } = testing;

const acceptsAMsaAiCredentialstore = () =>
  runTest(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      yield* awaited(
        credentials.modify("anthropic-api", () =>
          Promise.resolve({ key: "stored-key", type: "api_key" }),
        ),
      );
      const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));

      expect((yield* awaited(runtime.getAuth("anthropic-api")))?.auth.apiKey).toBe("stored-key");
    }),
  );

const scopesProviderAvailabilityReadsAndRecordsRefresh = () =>
  runTest(
    Effect.gen(function* () {
      const base = new InMemoryCredentialStore();
      const reads: string[] = [];
      let failReads = false;
      const credentials: aiTypes.CredentialStore = {
        delete: (providerId) => base.delete(providerId),
        list: () => base.list(),
        modify: (providerId, fn) => base.modify(providerId, fn),
        read: (providerId) => {
          reads.push(providerId);
          if (failReads) return Promise.reject(new Error(`read failed for ${providerId}`));
          return base.read(providerId);
        },
      };
      const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));

      reads.length = 0;
      yield* awaited(runtime.getAvailable("anthropic-api"));
      expect(new Set(reads)).toEqual(new Set(["anthropic-api"]));

      failReads = true;
      expect(yield* failure(awaited(runtime.getAvailable("anthropic-api")))).toMatchObject({
        message: "Credential store read failed for anthropic-api",
      });
      expect(runtime.getError()).toContain(
        "Availability refresh: Credential store read failed for anthropic-api",
      );

      failReads = false;
      yield* awaited(runtime.getAvailable());
      expect(runtime.getError()).toBeUndefined();
    }),
  );

const projectsProviderOwnedMethodsNamesAndStatus = () =>
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
            method: expect.objectContaining({ name: "OpenRouter API key" }),
            provider: expect.objectContaining({ id: "openrouter", name: "OpenRouter" }),
            type: "api_key",
          }),
          expect.objectContaining({
            provider: expect.objectContaining({ id: "openai", name: "OpenAI" }),
            type: "oauth",
          }),
        ]),
      );
      expect(
        authOptions(runtime)
          .filter((option) => option.type === "api_key")
          .every((option) => option.type === "api_key"),
      ).toBe(true);
      expect(
        authOptions(runtime)
          .filter((option) => option.type === "oauth")
          .every((option) => option.type === "oauth"),
      ).toBe(true);
      expect(
        options.some(
          (option) => option.provider.id === "openai-codex" && option.type === "api_key",
        ),
      ).toBe(false);
    }),
  );

const attachesTheProviderSActiveAuthStatus = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          credentials: AuthStorage.inMemory({
            openai: {
              access: "access",
              expires: currentTimeMillis() + 60_000,
              refresh: "refresh",
              type: "oauth",
            },
          }),
          modelsPath: null,
        }),
      );

      const options = authOptions(runtime).filter((option) => option.provider.id === "openai");
      expect(options).toHaveLength(2);
      expect(yield* awaited(runtime.checkAuth("openai"))).toMatchObject({ type: "oauth" });
    }),
  );

const distinguishesSubscriptionOauthFromGenericOauthSign = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          credentials: AuthStorage.inMemory({
            openai: {
              access: "openai-access",
              expires: currentTimeMillis() + 60 * 60_000,
              refresh: "openai-refresh",
              type: "oauth",
            },
            openrouter: {
              access: "openrouter-key",
              expires: Number.MAX_SAFE_INTEGER,
              refresh: "",
              type: "oauth",
            },
          }),
          modelsPath: null,
        }),
      );

      expect(runtime.isUsingOAuth("openai")).toBe(true);
      expect(runtime.isUsingSubscription("openai")).toBe(true);
      expect(runtime.isUsingOAuth("openrouter")).toBe(true);
      expect(runtime.isUsingSubscription("openrouter")).toBe(false);
    }),
  );

describe("ModelRuntime auth options", () => {
  it("accepts a msa-ai CredentialStore", acceptsAMsaAiCredentialstore);

  it(
    "scopes provider availability reads and records refresh failures",
    scopesProviderAvailabilityReadsAndRecordsRefresh,
  );

  it(
    "projects provider-owned methods, names, and status",
    projectsProviderOwnedMethodsNamesAndStatus,
  );

  it(
    "attaches the provider's active auth status to every method option",
    attachesTheProviderSActiveAuthStatus,
  );

  it(
    "distinguishes subscription OAuth from generic OAuth sign-in",
    distinguishesSubscriptionOauthFromGenericOauthSign,
  );
});
