import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import credentialStore from "../src/auth/credential-store.ts";
import modelsModule from "../src/models.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { InMemoryCredentialStore } = credentialStore;
const { currentTimeMillis } = clock;
const { calculateCost, createModels, hasApi } = modelsModule;

const { storeCredential, testModel, testProvider } = modelsRuntimeSupport;
const enumeratesCredentialMetadataWithoutExposingSecrets = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      yield* storeCredential(credentials, "api-provider", { key: "secret", type: "api_key" });
      yield* storeCredential(credentials, "oauth-provider", {
        access: "access",
        expires: currentTimeMillis() + 60_000,
        refresh: "refresh",
        type: "oauth",
      });

      expect(yield* Effect.promise(() => credentials.list())).toEqual([
        { providerId: "api-provider", type: "api_key" },
        { providerId: "oauth-provider", type: "oauth" },
      ]);
    }),
  );

const appliesRequestWidePricingTiersAbove = () => {
  const model = testModel("openai", "gpt-5.6-sol");
  model.cost = {
    cacheRead: 0.5,
    cacheWrite: 6.25,
    input: 5,
    output: 30,
    tiers: [
      {
        cacheRead: 1,
        cacheWrite: 12.5,
        input: 10,
        inputTokensAbove: 272000,
        output: 45,
      },
    ],
  };
  const createUsage = (cacheWrite: number): typesModule.Usage => ({
    cacheRead: 72000,
    cacheWrite,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 200000,
    output: 100000,
    totalTokens: 372000 + cacheWrite,
  });

  const short = calculateCost(model, createUsage(0));
  expect(short).toMatchObject({ cacheRead: 0.036, cacheWrite: 0, input: 1, output: 3 });

  const long = calculateCost(model, createUsage(1));
  expect(long.input).toBe(2);
  expect(long.output).toBe(4.5);
  expect(long.cacheRead).toBe(0.072);
  expect(long.cacheWrite).toBe(0.0000125);
};

const registersReplacesAndDeletesProviders = () => {
  const models = createModels();
  models.setProvider(testProvider({ id: "p1" }));
  models.setProvider(testProvider({ id: "p2" }));
  expect(models.getProviders().map((p) => p.id)).toEqual(["p1", "p2"]);

  const replacement = testProvider({ id: "p1" });
  models.setProvider(replacement);
  expect(models.getProvider("p1")).toBe(replacement);
  expect(models.getProviders()).toHaveLength(2);

  models.deleteProvider("p1");
  expect(models.getProvider("p1")).toBeUndefined();

  models.clearProviders();
  expect(models.getProviders()).toHaveLength(0);
};

const listsAndFindsModelsPerProvider = () => {
  const models = createModels();
  models.setProvider(
    testProvider({ id: "p1", models: [testModel("p1", "m1"), testModel("p1", "m2")] }),
  );
  models.setProvider(testProvider({ id: "p2", models: [testModel("p2", "m3")] }));

  expect(models.getModels().map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  expect(models.getModels("p1").map((m) => m.id)).toEqual(["m1", "m2"]);
  expect(models.getModels("nope").length).toBe(0);
  expect(models.getModel("p2", "m3")?.id).toBe("m3");
  expect(models.getModel("p2", "missing")).toBeUndefined();

  const found = models.getModel("p2", "m3");
  expect(found && hasApi(found, "openai-completions")).toBe(false);
  expect(found && hasApi(found, "test-api")).toBe(true);
  if (found !== undefined && hasApi(found, "test-api")) {
    const typed: typesModule.Model<"test-api"> = found;
    expect(typed.id).toBe("m3");
  }

  return Promise.resolve();
};

describe("Models runtime", () => {
  it(
    "enumerates credential metadata without exposing secrets",
    enumeratesCredentialMetadataWithoutExposingSecrets,
  );
});

describe("Models runtime", () => {
  it(
    "applies request-wide pricing tiers above the configured input threshold",
    appliesRequestWidePricingTiersAbove,
  );
});

describe("Models runtime", () => {
  it("registers, replaces, and deletes providers", registersReplacesAndDeletesProviders);

  it("lists and finds models per provider", listsAndFindsModelsPerProvider);
});
