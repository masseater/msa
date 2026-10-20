import { Effect } from "effect";
import { Base64Url } from "effect/encoding";
import { describe, expect, it } from "vite-plus/test";

import credentialStore from "../src/auth/credential-store.ts";
import modelsModule from "../src/models.ts";
import openrouter from "../src/providers/openrouter.ts";
import openrouterOauthSupport from "./openrouter-oauth-support.ts";

const { openrouterProvider } = openrouter;
const { InMemoryCredentialStore } = credentialStore;
const { createModels } = modelsModule;

const {
  callbackUrlOf,
  jsonResponse,
  loginThroughCallback,
  permanentKey,
  restoreStubsAfterEach,
  stubTokenExchange,
} = openrouterOauthSupport;

const isExposedWithApiKeyAuth = () => {
  const provider = openrouterProvider();
  expect(provider.auth.apiKey).toBeDefined();
  expect(provider.auth.oauth?.loginLabel).toBe("Sign in with OpenRouter");
};

const resolvesStoredKeyForEveryModelType = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      yield* Effect.promise(() =>
        credentials.modify("openrouter", () => Promise.resolve(permanentKey("sk-or-stored"))),
      );
      const models = createModels({ credentials });
      models.setProvider(openrouterProvider());
      const chatModel = models.getModels("openrouter")[0];
      const imageModel = models.getModelsOfType("image", "openrouter")[0];
      if (chatModel === undefined || imageModel === undefined) {
        throw new Error("Expected OpenRouter chat and image models");
      }
      const chatAuth = yield* Effect.promise(() => models.getAuth(chatModel));
      const imageAuth = yield* Effect.promise(() => models.getAuth(imageModel));
      expect([chatAuth?.auth.apiKey, imageAuth?.auth.apiKey]).toEqual([
        "sk-or-stored",
        "sk-or-stored",
      ]);
    }),
  );

const sha256Base64Url = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) => Base64Url.encode(new Uint8Array(digest))),
  );

const exchangesLoopbackCodeForKey = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { exchanges, fetchMock } = stubTokenExchange(() => jsonResponse({ key: "sk-or-test" }));
      const run = loginThroughCallback("authorization-code");

      expect(yield* Effect.promise(() => run.login)).toEqual(permanentKey("sk-or-test"));
      expect((yield* Effect.promise(() => run.callbackResponse)).status).toBe(200);
      expect((yield* Effect.promise(() => run.promptSignal))?.aborted).toBe(true);
      const authorizeUrl = yield* Effect.promise(() => run.authorizeUrl);
      expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe("https://openrouter.ai/auth");
      expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
      const callbackUrl = callbackUrlOf(authorizeUrl);
      expect(callbackUrl.hostname).toBe("127.0.0.1");
      expect(callbackUrl.pathname).toMatch(/^\/oauth\/callback\/[0-9a-f-]+$/u);
      expect(yield* exchanges).toEqual([
        expect.objectContaining({ code: "authorization-code", code_challenge_method: "S256" }),
      ]);
      const [exchange] = (yield* exchanges) as Record<string, unknown>[];
      const verifier = String(exchange?.["code_verifier"]);
      expect(authorizeUrl.searchParams.get("code_challenge")).toBe(
        yield* sha256Base64Url(verifier),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }),
  );

describe("OpenRouter OAuth", () => {
  restoreStubsAfterEach();

  it("is exposed alongside API-key auth", isExposedWithApiKeyAuth);
  it(
    "resolves the same stored OAuth key for chat and image models",
    resolvesStoredKeyForEveryModelType,
  );
  it(
    "runs PKCE on a one-shot loopback callback and exchanges the code for a permanent API key",
    exchangesLoopbackCodeForKey,
  );
});
