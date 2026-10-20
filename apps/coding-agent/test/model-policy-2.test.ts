import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import coreModelPolicy from "../src/core/model-policy.ts";
import modelResolver from "../src/core/model-resolver.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import modelPolicyModule from "../src/core/tools/model-policy.ts";
import toolDefinitionWrapper from "../src/core/tools/tool-definition-wrapper.ts";
import modelPolicySupport from "./model-policy-support.ts";

const { findModelPolicyDenial, resolveCliModel } = modelResolver;
const { wrapToolDefinition } = toolDefinitionWrapper;
const { createModelPolicyToolDefinition } = modelPolicyModule;
const { saveModelPolicy } = coreModelPolicy;

const { awaited, runTest } = testing;

const { cleanupRuntimeDirs, createRuntime, policy } = modelPolicySupport;

afterEach(cleanupRuntimeDirs);

const hidesADeniedModelFromEveryListing = () =>
  runTest(
    Effect.gen(function* () {
      const { modelRuntime } = yield* awaited(createRuntime({ deny: ["local/alpha-2"] }));
      expect(modelRuntime.getModels("local").map((entry) => entry.id)).toEqual([
        "alpha-1",
        "beta-1",
      ]);
      expect(modelRuntime.getModel("local", "alpha-2")).toBeUndefined();
      expect(modelRuntime.getCatalogModels("local").map((entry) => entry.id)).toEqual([
        "alpha-1",
        "alpha-2",
        "beta-1",
      ]);
    }),
  );

const keepsARunningSessionSModelWhen = () =>
  runTest(
    Effect.gen(function* () {
      const { modelRuntime } = yield* awaited(createRuntime());
      const running = modelRuntime.getModel("local", "alpha-2");
      expect(running).toBeDefined();
      modelRuntime.setModelPolicy(policy([], ["local/*"]));
      expect(modelRuntime.getModels("local")).toEqual([]);
      expect(modelRuntime.getModel("local", "alpha-2")).toBeUndefined();
    }),
  );

describe("ModelRuntime", () => {
  it(
    "hides a denied model from every listing and lookup, including a models.json provider",
    hidesADeniedModelFromEveryListing,
  );

  it(
    "keeps a running session's model when a later policy would deny it",
    keepsARunningSessionSModelWhen,
  );
});

const namesTheDenyPatternInsteadOfFalling = () =>
  runTest(
    Effect.gen(function* () {
      const { modelRuntime } = yield* awaited(createRuntime({ deny: ["local/alpha-2"] }));
      const result = resolveCliModel({
        cliModel: "local/alpha-2",
        modelRuntime,
      });
      expect(result.model).toBeUndefined();
      expect(result.error).toBe(
        'Model "local/alpha-2" is denied by model policy pattern "local/alpha-2". Open /model to change it.',
      );
    }),
  );

const resolvesAnAllowedModel = () =>
  runTest(
    Effect.gen(function* () {
      const { modelRuntime } = yield* awaited(createRuntime({ deny: ["local/alpha-2"] }));
      const result = resolveCliModel({ cliModel: "local/alpha-1", modelRuntime });
      expect(result.model?.id).toBe("alpha-1");
      expect(result.error).toBeUndefined();
    }),
  );

const explainsADenialForTheModelCommand = () =>
  runTest(
    Effect.gen(function* () {
      const { modelRuntime } = yield* awaited(createRuntime({ deny: ["local/*"] }));
      const denial = findModelPolicyDenial({
        catalogModels: modelRuntime.getCatalogModels(),
        policy: modelRuntime.getModelPolicy(),
        reference: "alpha-1",
      });
      expect(denial?.model.id).toBe("alpha-1");
      expect(denial?.message).toBe('denied by model policy pattern "local/*"');
    }),
  );

describe("explicit model selection", () => {
  it(
    "names the deny pattern instead of falling back to another model",
    namesTheDenyPatternInsteadOfFalling,
  );

  it("resolves an allowed model", resolvesAnAllowedModel);

  it("explains a denial for the /model command", explainsADenialForTheModelCommand);
});

function createTool(deny: string[] = []) {
  return runTest(
    Effect.gen(function* () {
      const { modelRuntime } = yield* awaited(createRuntime({ deny }));
      const settingsManager = SettingsManager.inMemory();
      const tool = wrapToolDefinition(
        createModelPolicyToolDefinition({
          currentModel: () => modelRuntime.getModel("local", "alpha-1"),
          modelRuntime,
          settingsManager,
        }),
      );
      return { modelRuntime, settingsManager, tool };
    }),
  );
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((part) => part.text ?? "").join("\n");
}

const listsThePatternsAndTheModelsThey = () =>
  runTest(
    Effect.gen(function* () {
      const { tool } = yield* awaited(createTool(["local/alpha-2"]));
      const result = yield* awaited(tool.execute("call-1", { action: "list" }));
      expect(text(result)).toContain("deny: local/alpha-2");
      expect(text(result)).toContain("current: local/alpha-1 allowed");
      expect(text(result)).toContain("local/alpha-2 (local/alpha-2)");
    }),
  );

const hidesAModelForTheNextListing = () =>
  runTest(
    Effect.gen(function* () {
      const { tool, modelRuntime, settingsManager } = yield* awaited(createTool());
      const result = yield* awaited(
        tool.execute("call-1", { action: "deny", pattern: "local/beta-1" }),
      );
      expect(text(result)).toContain('deny "local/beta-1"');
      expect(text(result)).toContain("local/beta-1 (local/beta-1)");
      expect(modelRuntime.getModels("local").map((entry) => entry.id)).toEqual([
        "alpha-1",
        "alpha-2",
      ]);
      expect(settingsManager.getGlobalSettings().modelPolicy).toEqual({ deny: ["local/beta-1"] });
    }),
  );

const refusesToDenyTheModelTheSession = () =>
  runTest(
    Effect.gen(function* () {
      const { tool, modelRuntime, settingsManager } = yield* awaited(createTool());
      yield* awaited(
        expect(tool.execute("call-1", { action: "deny", pattern: "local/*" })).rejects.toThrow(
          "would disable local/alpha-1, the model this session is running",
        ),
      );
      expect(settingsManager.getGlobalSettings().modelPolicy).toBeUndefined();
      expect(modelRuntime.getModel("local", "alpha-1")).toBeDefined();
    }),
  );

const allowsAHiddenModelAgain = () =>
  runTest(
    Effect.gen(function* () {
      const { tool, modelRuntime } = yield* awaited(createTool(["local/alpha-2"]));
      yield* awaited(tool.execute("call-1", { action: "allow", pattern: "local/alpha-2" }));
      expect(modelRuntime.getModel("local", "alpha-2")).toBeDefined();
    }),
  );

describe("model_policy tool", () => {
  it("lists the patterns and the models they hide", listsThePatternsAndTheModelsThey);

  it("hides a model for the next listing and reports the pattern", hidesAModelForTheNextListing);

  it("refuses to deny the model the session is running", refusesToDenyTheModelTheSession);

  it("allows a hidden model again", allowsAHiddenModelAgain);
});

const writesTheSettingAndRefreshesTheCatalog = () =>
  runTest(
    Effect.gen(function* () {
      const { modelRuntime } = yield* awaited(createRuntime());
      const settingsManager = SettingsManager.inMemory();
      saveModelPolicy({ modelRuntime, settingsManager }, policy([], ["local/*"]));
      expect(settingsManager.getGlobalSettings().modelPolicy?.deny).toEqual(["local/*"]);
      expect(modelRuntime.getModels("local")).toEqual([]);
    }),
  );

describe("saveModelPolicy", () => {
  it(
    "writes the setting and refreshes the catalog in one call",
    writesTheSettingAndRefreshesTheCatalog,
  );
});
