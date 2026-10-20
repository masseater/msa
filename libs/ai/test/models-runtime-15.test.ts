import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import type { ApiKeyAuth } from "../src/auth/types.ts";
import { createModels } from "../src/models.ts";
import type { Api, Model, StreamOptions } from "../src/types.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { context, storeCredential, testModel, testOAuth, testProvider } = modelsRuntimeSupport;

interface ProviderCall {
  model: Model<Api>;
  options: StreamOptions | undefined;
}

const keepsTheUnderlyingReasonInWrapped = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      yield* storeCredential(credentials, "p1", {
        access: "old",
        expires: 0,
        refresh: "r",
        type: "oauth",
      });
      const models = createModels({ credentials });
      models.setProvider(
        testProvider({
          auth: {
            oauth: testOAuth({
              refresh: () => Promise.reject(new Error("token refresh failed (400): invalid_grant")),
            }),
          },
          id: "p1",
        }),
      );

      yield* Effect.promise(() =>
        expect(models.getAuth("p1")).rejects.toThrow(
          "OAuth refresh failed for p1: token refresh failed (400): invalid_grant",
        ),
      );
    }),
  );

const wrapsApiKeyAuthFailuresIn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const failing: ApiKeyAuth = {
        name: "Failing",
        resolve: () => Promise.reject(new Error("nope")),
      };
      const models = createModels();
      models.setProvider(testProvider({ auth: { apiKey: failing }, id: "p1" }));
      yield* Effect.promise(() =>
        expect(models.getAuth("p1")).rejects.toMatchObject({ code: "auth" }),
      );
    }),
  );

const usesExplicitRequestApiKeyAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context();
      const calls: ProviderCall[] = [];
      const apiKey: ApiKeyAuth = {
        name: "Scoped",
        resolve: ({ credential, ctx }) =>
          Effect.runPromiseWith(effectContext)(
            Effect.gen(function* () {
              const account =
                credential?.env?.["ACCOUNT_ID"] ??
                (yield* Effect.promise(() => ctx.env("ACCOUNT_ID")));
              if (
                credential?.key === undefined ||
                credential?.key === "" ||
                account === undefined ||
                account === ""
              )
                return undefined;
              return {
                auth: { apiKey: credential.key, baseUrl: `https://example.test/${account}` },
                env: { ACCOUNT_ID: account },
              };
            }),
          ),
      };
      const models = createModels();
      models.setProvider(testProvider({ auth: { apiKey }, calls, id: "p1" }));
      const model = testModel("p1", "model-a");

      yield* Effect.promise(() =>
        models.completeSimple(model, context, {
          apiKey: "explicit-key",
          env: { ACCOUNT_ID: "acct" },
        }),
      );

      expect(calls[0]?.model.baseUrl).toBe("https://example.test/acct");
      expect(calls[0]?.options?.apiKey).toBe("explicit-key");
      expect(calls[0]?.options?.env).toEqual({ ACCOUNT_ID: "acct" });
    }),
  );

describe("Models runtime", () => {
  it(
    "keeps the underlying reason in wrapped oauth refresh errors",
    keepsTheUnderlyingReasonInWrapped,
  );
});

describe("Models runtime", () => {
  it("wraps api-key auth failures in ModelsError", wrapsApiKeyAuthFailuresIn);
});

describe("Models runtime", () => {
  it(
    "uses explicit request api key and env during provider auth resolution",
    usesExplicitRequestApiKeyAnd,
  );
});
