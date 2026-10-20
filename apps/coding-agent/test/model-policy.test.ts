import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import InMemorySettingsStorage from "../src/core/in-memory-settings-storage.ts";
import modelPolicyModule from "../src/core/model-policy.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import modelPolicySupport from "./model-policy-support.ts";

const {
  EMPTY_MODEL_POLICY,
  addModelPolicyPattern,
  allowModelReference,
  describeModelPolicyDenial,
  evaluateModelPolicy,
  hiddenModelsByPolicy,
  mergeModelPolicies,
  removeModelPolicyPattern,
  withModelPolicy,
} = modelPolicyModule;
const { removePath, runTest } = testing;

const { model, policy } = modelPolicySupport;

const tempDirs: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const dir of tempDirs.splice(0)) yield* removePath(dir);
    }),
  ),
);

const letsADenyPatternWinOverAn = () => {
  const subject = policy(["openrouter/*"], ["openrouter/kimi-*"]);
  expect(evaluateModelPolicy(subject, model("openrouter", "kimi-k2.6"))).toEqual({
    allowed: false,
    pattern: "openrouter/kimi-*",
    reason: "deny",
  });
  expect(evaluateModelPolicy(subject, model("openrouter", "moonshotai/kimi-k2.6"))).toEqual({
    allowed: true,
    allowedBy: "openrouter/*",
  });
};

const restrictsToTheAllowListWhenOne = () => {
  const subject = policy(["anthropic-api/*"], []);
  expect(evaluateModelPolicy(subject, model("anthropic-api", "claude-opus-4-8")).allowed).toBe(
    true,
  );
  expect(evaluateModelPolicy(subject, model("openai", "gpt-5.5"))).toEqual({
    allowed: false,
    pattern: undefined,
    reason: "not-allowed",
  });
};

const matchesProviderForIdsThatContainA = () => {
  const subject = policy([], ["openrouter/*"]);
  expect(evaluateModelPolicy(subject, model("openrouter", "moonshotai/kimi-k2.6")).allowed).toBe(
    false,
  );
  expect(evaluateModelPolicy(subject, model("openai", "gpt-5.5")).allowed).toBe(true);
};

const matchesAcrossEveryProvider = () => {
  const subject = policy([], ["*"]);
  expect(evaluateModelPolicy(subject, model("openrouter", "moonshotai/kimi-k2.6")).allowed).toBe(
    false,
  );
  expect(evaluateModelPolicy(subject, model("anthropic-api", "claude-opus-4-8")).allowed).toBe(
    false,
  );
};

const ignoresAThinkingSuffixAndKeepsAn = () => {
  const subject = policy([], ["openai/gpt-5.5:high"]);
  expect(evaluateModelPolicy(subject, model("openai", "gpt-5.5")).allowed).toBe(false);
  expect(
    evaluateModelPolicy(policy([], ["openrouter/qwen/qwen3-coder:exacto"]), {
      id: "qwen/qwen3-coder:exacto",
      provider: "openrouter",
    }).allowed,
  ).toBe(false);
};

const combinesLayersByUnionSoAProject = () => {
  const merged = mergeModelPolicies(
    policy([], ["openai/*"]),
    policy(["anthropic-api/*"], ["openrouter/*"]),
  );
  expect(merged).toEqual({ allow: ["anthropic-api/*"], deny: ["openai/*", "openrouter/*"] });
};

const liftsADenyWithoutTurningTheRest = () => {
  expect(allowModelReference(policy([], ["openai/*", "openai/gpt-5.5"]), "openai/gpt-5.5")).toEqual(
    { allow: [], deny: ["openai/*"] },
  );
};

const joinsAnExistingAllowListInsteadOf = () => {
  expect(allowModelReference(policy(["anthropic-api/*"], []), "openai/gpt-5.5")).toEqual({
    allow: ["anthropic-api/*", "openai/gpt-5.5"],
    deny: [],
  });
};

const reportsThePatternThatHidesEachModel = () => {
  const hidden = hiddenModelsByPolicy(policy([], ["openai/*"]), [
    model("openai", "gpt-5.5"),
    model("anthropic-api", "claude-opus-4-8"),
  ]);
  expect(hidden.map((entry) => [entry.model.id, entry.pattern])).toEqual([["gpt-5.5", "openai/*"]]);
  expect(describeModelPolicyDenial(policy([], ["openai/*"]), model("openai", "gpt-5.5"))).toBe(
    'denied by model policy pattern "openai/*"',
  );
};

const addsAndRemovesPatternsWithoutDuplicatingA = () => {
  const added = addModelPolicyPattern(policy(["openai/*"], []), "deny", "OpenAI/*");
  expect(added).toEqual({ allow: [], deny: ["OpenAI/*"] });
  expect(addModelPolicyPattern(added, "deny", "openai/*").deny).toEqual(["OpenAI/*"]);
  expect(removeModelPolicyPattern(added, "OPENAI/*").deny).toEqual([]);
};

describe("model policy patterns", () => {
  it("lets a deny pattern win over an allow pattern", letsADenyPatternWinOverAn);

  it("restricts to the allow list when one is set", restrictsToTheAllowListWhenOne);

  it("matches provider/* for ids that contain a slash", matchesProviderForIdsThatContainA);

  it("matches * across every provider", matchesAcrossEveryProvider);

  it(
    "ignores a thinking suffix and keeps an unknown suffix in the pattern",
    ignoresAThinkingSuffixAndKeepsAn,
  );

  it(
    "combines layers by union, so a project cannot lift a machine deny",
    combinesLayersByUnionSoAProject,
  );

  it(
    "lifts a deny without turning the rest of the catalog into an allow list",
    liftsADenyWithoutTurningTheRest,
  );

  it("joins an existing allow list instead of widening it", joinsAnExistingAllowListInsteadOf);

  it("reports the pattern that hides each model", reportsThePatternThatHidesEachModel);

  it(
    "adds and removes patterns without duplicating a different spelling",
    addsAndRemovesPatternsWithoutDuplicatingA,
  );
});

const provider2: aiTypes.Provider = {
  auth: {
    apiKey: {
      name: "key",
      resolve: () => runTest(Effect.sync(() => ({ auth: {}, source: "test" }))),
    },
  },
  getModels: () => [model("custom", "allowed-1"), model("custom", "blocked-1")],
  id: "custom",
  name: "Custom",
  stream: () => {
    throw new Error("not used");
  },
  streamSimple: () => {
    throw new Error("not used");
  },
};

const returnsTheProviderUntouchedWhenThePolicy = () => {
  expect(withModelPolicy(provider2, EMPTY_MODEL_POLICY)).toBe(provider2);
};

const hidesTheModelsThePolicyDenies = () => {
  const filtered = withModelPolicy(provider2, policy([], ["custom/blocked-1"]));
  expect(filtered.getModels().map((entry) => entry.id)).toEqual(["allowed-1"]);
};

describe("withModelPolicy", () => {
  it(
    "returns the provider untouched when the policy restricts nothing",
    returnsTheProviderUntouchedWhenThePolicy,
  );

  it("hides the models the policy denies", hidesTheModelsThePolicyDenies);
});

const combinesTheAgentDirectoryAndProjectLayers = () => {
  const storage = new InMemorySettingsStorage();
  storage.withLock("global", () => JSON.stringify({ modelPolicy: { deny: ["openai/*"] } }));
  storage.withLock("project", () =>
    JSON.stringify({ modelPolicy: { allow: ["openai/gpt-5.5"], deny: ["openrouter/*"] } }),
  );
  const manager = SettingsManager.fromStorage(storage);
  expect(manager.models.getModelPolicy()).toEqual({
    allow: ["openai/gpt-5.5"],
    deny: ["openai/*", "openrouter/*"],
  });
};

const writesThePolicyToTheAgentDirectory = () => {
  const storage = new InMemorySettingsStorage();
  const manager = SettingsManager.fromStorage(storage);
  manager.models.setModelPolicy(policy(["anthropic-api/*"], ["openrouter/*"]));
  expect(manager.getGlobalSettings().modelPolicy).toEqual({
    allow: ["anthropic-api/*"],
    deny: ["openrouter/*"],
  });
  expect(manager.getProjectSettings().modelPolicy).toBeUndefined();
};

const dropsAnEmptyPolicyInsteadOfWriting = () => {
  const manager = SettingsManager.inMemory({
    modelPolicy: { allow: [], deny: ["openai/*"] },
  });
  manager.models.setModelPolicy(EMPTY_MODEL_POLICY);
  expect(manager.getGlobalSettings().modelPolicy).toBeUndefined();
};

describe("settings", () => {
  it("combines the agent-directory and project layers", combinesTheAgentDirectoryAndProjectLayers);

  it("writes the policy to the agent-directory layer", writesThePolicyToTheAgentDirectory);

  it("drops an empty policy instead of writing empty lists", dropsAnEmptyPolicyInsteadOfWriting);
});
