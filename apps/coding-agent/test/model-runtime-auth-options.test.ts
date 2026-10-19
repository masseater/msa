import { type CredentialStore, InMemoryCredentialStore } from "@msa/ai";
import { awaited, currentTimeMillis, failure, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { authOptions } from "./model-runtime-auth-support.ts";

describe("ModelRuntime auth options", () => {
  it("accepts a msa-ai CredentialStore", () =>
    runTest(
      Effect.gen(function* () {
        const credentials = new InMemoryCredentialStore();
        yield* awaited(
          credentials.modify("anthropic-api", () =>
            Promise.resolve({ type: "api_key", key: "stored-key" }),
          ),
        );
        const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));

        expect((yield* awaited(runtime.getAuth("anthropic-api")))?.auth.apiKey).toBe("stored-key");
      }),
    ));

  it("scopes provider availability reads and records refresh failures", () =>
    runTest(
      Effect.gen(function* () {
        const base = new InMemoryCredentialStore();
        const reads: string[] = [];
        let failReads = false;
        const credentials: CredentialStore = {
          read: (providerId) => {
            reads.push(providerId);
            if (failReads) throw new Error(`read failed for ${providerId}`);
            return base.read(providerId);
          },
          list: () => base.list(),
          modify: (providerId, fn) => base.modify(providerId, fn),
          delete: (providerId) => base.delete(providerId),
        };
        const runtime = yield* awaited(ModelRuntime.create({ credentials, modelsPath: null }));

        reads.length = 0;
        yield* awaited(runtime.getAvailable("anthropic-api"));
        expect(new Set(reads)).toEqual(new Set(["anthropic-api"]));

        failReads = true;
        expect(yield* failure(awaited(runtime.getAvailable("anthropic-api")))).toMatchObject({
          message: "Credential store read failed for anthropic",
        });
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
              type: "api_key",
              provider: expect.objectContaining({ id: "openrouter", name: "OpenRouter" }),
              method: expect.objectContaining({ name: "OpenRouter API key" }),
            }),
            expect.objectContaining({
              type: "oauth",
              provider: expect.objectContaining({ id: "openai", name: "OpenAI" }),
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
    ));

  it("attaches the provider's active auth status to every method option", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory({
              openai: {
                type: "oauth",
                access: "access",
                refresh: "refresh",
                expires: currentTimeMillis() + 60_000,
              },
            }),
            modelsPath: null,
          }),
        );

        const options = authOptions(runtime).filter((option) => option.provider.id === "openai");
        expect(options).toHaveLength(2);
        expect(yield* awaited(runtime.checkAuth("openai"))).toMatchObject({ type: "oauth" });
      }),
    ));

  it("distinguishes subscription OAuth from generic OAuth sign-in", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          ModelRuntime.create({
            credentials: AuthStorage.inMemory({
              openai: {
                type: "oauth",
                access: "openai-access",
                refresh: "openai-refresh",
                expires: currentTimeMillis() + 60 * 60_000,
              },
              openrouter: {
                type: "oauth",
                access: "openrouter-key",
                refresh: "",
                expires: Number.MAX_SAFE_INTEGER,
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
    ));
});
