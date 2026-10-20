import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { storeCredential, testOAuth, testProvider } = modelsRuntimeSupport;
const refreshesOauthCredentialsWithLessThan = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const refresh = vi.fn((credential) =>
        Promise.resolve({
          ...credential,
          access: "new-token",
          expires: currentTimeMillis() + 60 * 60_000,
        }),
      );
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { oauth: testOAuth({ refresh }) }, id: "p1" }));
      yield* storeCredential(credentials, "p1", {
        access: "old-token",
        expires: currentTimeMillis() + 60_000,
        refresh: "r",
        type: "oauth",
      });

      expect((yield* Effect.promise(() => models.getAuth("p1")))?.auth.apiKey).toBe("new-token");
      expect(refresh).toHaveBeenCalledOnce();
    }),
  );

const honorsACallerSLongerOAuth = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const refresh = vi.fn((credential) =>
        Promise.resolve({
          ...credential,
          access: "new-token",
          expires: currentTimeMillis() + 60 * 60_000,
        }),
      );
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { oauth: testOAuth({ refresh }) }, id: "p1" }));
      yield* storeCredential(credentials, "p1", {
        access: "old-token",
        expires: currentTimeMillis() + 10 * 60_000,
        refresh: "r",
        type: "oauth",
      });

      expect(
        (yield* Effect.promise(() => models.getAuth("p1", { minOAuthValidityMs: 30 * 60_000 })))
          ?.auth.apiKey,
      ).toBe("new-token");
      expect(refresh).toHaveBeenCalledOnce();
    }),
  );

const rejectsWithCodeOauthWhenRefresh = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const oauth = testOAuth({
        refresh: () => Promise.reject(new Error("invalid_grant")),
      });
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { oauth }, id: "p1" }));
      yield* storeCredential(credentials, "p1", {
        access: "old",
        expires: 0,
        refresh: "r",
        type: "oauth",
      });

      yield* Effect.promise(() =>
        expect(models.getAuth("p1")).rejects.toMatchObject({ code: "oauth" }),
      );
      expect(
        ((yield* Effect.promise(() => credentials.read("p1"))) as { access: string }).access,
      ).toBe("old");
    }),
  );

describe("Models runtime", () => {
  it(
    "refreshes oauth credentials with less than five minutes remaining",
    refreshesOauthCredentialsWithLessThan,
  );
});

describe("Models runtime", () => {
  it("honors a caller's longer OAuth minimum validity", honorsACallerSLongerOAuth);
});

describe("Models runtime", () => {
  it(
    "rejects with code oauth when refresh fails, preserving the stored credential",
    rejectsWithCodeOauthWhenRefresh,
  );
});
