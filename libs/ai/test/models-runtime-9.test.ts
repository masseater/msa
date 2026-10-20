import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createModels } from "../src/models.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { testProvider } = modelsRuntimeSupport;

const blockedStep = <T>(value: T) => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  return {
    release: () => release.resolve(),
    run: () => {
      started.resolve();
      return release.promise.then(() => value);
    },
    started: started.promise,
  };
};

const modelsWithBlockedAuth = () => {
  const check = blockedStep({ type: "api_key" as const });
  const resolve = blockedStep({ auth: { apiKey: "key" } });
  const models = createModels();
  models.setProvider(
    testProvider({
      auth: { apiKey: { check: check.run, name: "Blocked auth", resolve: resolve.run } },
      id: "p1",
    }),
  );
  return { check, models, resolve };
};

const stopsWaitingForNonCooperativeAuth = () => {
  const authController = new AbortController();
  const availableController = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const { check, models, resolve } = modelsWithBlockedAuth();

      const available = models.getAvailable(undefined, { signal: availableController.signal });
      yield* Effect.promise(() => check.started);
      availableController.abort();
      yield* Effect.promise(() => expect(available).rejects.toMatchObject({ name: "AbortError" }));

      const auth = models.getAuth("p1", { signal: authController.signal });
      yield* Effect.promise(() => resolve.started);
      authController.abort();
      yield* Effect.promise(() => expect(auth).rejects.toMatchObject({ name: "AbortError" }));

      check.release();
      resolve.release();
    }),
  );
};

describe("Models runtime", () => {
  it("stops waiting for non-cooperative auth callbacks", stopsWaitingForNonCooperativeAuth);
});
