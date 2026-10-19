import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Api, Model, Provider } from "@msa/ai";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import {
  addModelPolicyPattern,
  allowModelReference,
  describeModelPolicyDenial,
  EMPTY_MODEL_POLICY,
  evaluateModelPolicy,
  hiddenModelsByPolicy,
  mergeModelPolicies,
  type ModelPolicy,
  removeModelPolicyPattern,
  saveModelPolicy,
  withModelPolicy,
} from "../src/core/model-policy.ts";
import { findModelPolicyDenial, resolveCliModel } from "../src/core/model-resolver.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../src/core/models-store.ts";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";
import { createModelPolicyToolDefinition } from "../src/core/tools/model-policy.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function model(provider: string, id: string): Model<Api> {
  return { id, name: id, provider } as unknown as Model<Api>;
}

function policy(allow: string[], deny: string[]): ModelPolicy {
  return { allow, deny };
}

describe("model policy patterns", () => {
  it("lets a deny pattern win over an allow pattern", () => {
    const subject = policy(["openrouter/*"], ["openrouter/kimi-*"]);
    expect(evaluateModelPolicy(subject, model("openrouter", "kimi-k2.6"))).toEqual({
      allowed: false,
      reason: "deny",
      pattern: "openrouter/kimi-*",
    });
    expect(evaluateModelPolicy(subject, model("openrouter", "moonshotai/kimi-k2.6"))).toEqual({
      allowed: true,
      allowedBy: "openrouter/*",
    });
  });

  it("restricts to the allow list when one is set", () => {
    const subject = policy(["anthropic-api/*"], []);
    expect(evaluateModelPolicy(subject, model("anthropic-api", "claude-opus-4-8")).allowed).toBe(
      true,
    );
    expect(evaluateModelPolicy(subject, model("openai", "gpt-5.5"))).toEqual({
      allowed: false,
      reason: "not-allowed",
      pattern: undefined,
    });
  });

  it("matches provider/* for ids that contain a slash", () => {
    const subject = policy([], ["openrouter/*"]);
    expect(evaluateModelPolicy(subject, model("openrouter", "moonshotai/kimi-k2.6")).allowed).toBe(
      false,
    );
    expect(evaluateModelPolicy(subject, model("openai", "gpt-5.5")).allowed).toBe(true);
  });

  it("matches * across every provider", () => {
    const subject = policy([], ["*"]);
    expect(evaluateModelPolicy(subject, model("openrouter", "moonshotai/kimi-k2.6")).allowed).toBe(
      false,
    );
    expect(evaluateModelPolicy(subject, model("anthropic-api", "claude-opus-4-8")).allowed).toBe(
      false,
    );
  });

  it("ignores a thinking suffix and keeps an unknown suffix in the pattern", () => {
    const subject = policy([], ["openai/gpt-5.5:high"]);
    expect(evaluateModelPolicy(subject, model("openai", "gpt-5.5")).allowed).toBe(false);
    expect(
      evaluateModelPolicy(policy([], ["openrouter/qwen/qwen3-coder:exacto"]), {
        provider: "openrouter",
        id: "qwen/qwen3-coder:exacto",
      }).allowed,
    ).toBe(false);
  });

  it("combines layers by union, so a project cannot lift a machine deny", () => {
    const merged = mergeModelPolicies(
      policy([], ["openai/*"]),
      policy(["anthropic-api/*"], ["openrouter/*"]),
    );
    expect(merged).toEqual({ allow: ["anthropic-api/*"], deny: ["openai/*", "openrouter/*"] });
  });

  it("lifts a deny without turning the rest of the catalog into an allow list", () => {
    expect(
      allowModelReference(policy([], ["openai/*", "openai/gpt-5.5"]), "openai/gpt-5.5"),
    ).toEqual({ allow: [], deny: ["openai/*"] });
  });

  it("joins an existing allow list instead of widening it", () => {
    expect(allowModelReference(policy(["anthropic-api/*"], []), "openai/gpt-5.5")).toEqual({
      allow: ["anthropic-api/*", "openai/gpt-5.5"],
      deny: [],
    });
  });

  it("reports the pattern that hides each model", () => {
    const hidden = hiddenModelsByPolicy(policy([], ["openai/*"]), [
      model("openai", "gpt-5.5"),
      model("anthropic-api", "claude-opus-4-8"),
    ]);
    expect(hidden.map((entry) => [entry.model.id, entry.pattern])).toEqual([
      ["gpt-5.5", "openai/*"],
    ]);
    expect(describeModelPolicyDenial(policy([], ["openai/*"]), model("openai", "gpt-5.5"))).toBe(
      'denied by model policy pattern "openai/*"',
    );
  });

  it("adds and removes patterns without duplicating a different spelling", () => {
    const added = addModelPolicyPattern(policy(["openai/*"], []), "deny", "OpenAI/*");
    expect(added).toEqual({ allow: [], deny: ["OpenAI/*"] });
    expect(addModelPolicyPattern(added, "deny", "openai/*").deny).toEqual(["OpenAI/*"]);
    expect(removeModelPolicyPattern(added, "OPENAI/*").deny).toEqual([]);
  });
});

describe("withModelPolicy", () => {
  const provider: Provider = {
    id: "custom",
    name: "Custom",
    auth: { apiKey: { name: "key", resolve: async () => ({ auth: {}, source: "test" }) } },
    getModels: () => [model("custom", "allowed-1"), model("custom", "blocked-1")],
    stream: () => {
      throw new Error("not used");
    },
    streamSimple: () => {
      throw new Error("not used");
    },
  };

  it("returns the provider untouched when the policy restricts nothing", () => {
    expect(withModelPolicy(provider, EMPTY_MODEL_POLICY)).toBe(provider);
  });

  it("hides the models the policy denies", () => {
    const filtered = withModelPolicy(provider, policy([], ["custom/blocked-1"]));
    expect(filtered.getModels().map((entry) => entry.id)).toEqual(["allowed-1"]);
  });
});

describe("settings", () => {
  it("combines the agent-directory and project layers", () => {
    const storage = new InMemorySettingsStorage();
    storage.withLock("global", () => JSON.stringify({ modelPolicy: { deny: ["openai/*"] } }));
    storage.withLock("project", () =>
      JSON.stringify({ modelPolicy: { allow: ["openai/gpt-5.5"], deny: ["openrouter/*"] } }),
    );
    const manager = SettingsManager.fromStorage(storage);
    expect(manager.getModelPolicy()).toEqual({
      allow: ["openai/gpt-5.5"],
      deny: ["openai/*", "openrouter/*"],
    });
  });

  it("writes the policy to the agent-directory layer", () => {
    const storage = new InMemorySettingsStorage();
    const manager = SettingsManager.fromStorage(storage);
    manager.setModelPolicy(policy(["anthropic-api/*"], ["openrouter/*"]));
    expect(manager.getGlobalSettings().modelPolicy).toEqual({
      allow: ["anthropic-api/*"],
      deny: ["openrouter/*"],
    });
    expect(manager.getProjectSettings().modelPolicy).toBeUndefined();
  });

  it("drops an empty policy instead of writing empty lists", () => {
    const manager = SettingsManager.inMemory({
      modelPolicy: { allow: [], deny: ["openai/*"] },
    });
    manager.setModelPolicy(EMPTY_MODEL_POLICY);
    expect(manager.getGlobalSettings().modelPolicy).toBeUndefined();
  });
});

async function createRuntime(settings: Partial<Record<string, unknown>> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "msa-policy-"));
  tempDirs.push(dir);
  const modelsPath = join(dir, "models.json");
  writeFileSync(
    modelsPath,
    JSON.stringify({
      providers: {
        local: {
          baseUrl: "http://127.0.0.1:9/v1",
          api: "openai-completions",
          apiKey: "local",
          models: [{ id: "alpha-1" }, { id: "alpha-2" }, { id: "beta-1" }],
        },
      },
    }),
  );
  const modelRuntime = await ModelRuntime.create({
    credentials: AuthStorage.inMemory(),
    modelsPath,
    modelsStore: new InMemoryCodingAgentModelsStore(),
    allowModelNetwork: false,
  });
  modelRuntime.setModelPolicy(
    mergeModelPolicies(EMPTY_MODEL_POLICY, {
      allow: [],
      deny: Array.isArray(settings["deny"]) ? (settings["deny"] as string[]) : [],
    }),
  );
  return { modelRuntime, dir };
}

describe("ModelRuntime", () => {
  it("hides a denied model from every listing and lookup, including a models.json provider", async () => {
    const { modelRuntime } = await createRuntime({ deny: ["local/alpha-2"] });
    expect(modelRuntime.getModels("local").map((entry) => entry.id)).toEqual(["alpha-1", "beta-1"]);
    expect(modelRuntime.getModel("local", "alpha-2")).toBeUndefined();
    expect(modelRuntime.getCatalogModels("local").map((entry) => entry.id)).toEqual([
      "alpha-1",
      "alpha-2",
      "beta-1",
    ]);
  });

  it("keeps a running session's model when a later policy would deny it", async () => {
    const { modelRuntime } = await createRuntime();
    const running = modelRuntime.getModel("local", "alpha-2");
    expect(running).toBeDefined();
    modelRuntime.setModelPolicy(policy([], ["local/*"]));
    expect(modelRuntime.getModels("local")).toEqual([]);
    expect(modelRuntime.getModel("local", "alpha-2")).toBeUndefined();
  });
});

describe("explicit model selection", () => {
  it("names the deny pattern instead of falling back to another model", async () => {
    const { modelRuntime } = await createRuntime({ deny: ["local/alpha-2"] });
    const result = resolveCliModel({
      cliModel: "local/alpha-2",
      modelRuntime,
    });
    expect(result.model).toBeUndefined();
    expect(result.error).toBe(
      'Model "local/alpha-2" is denied by model policy pattern "local/alpha-2". Open /model to change it.',
    );
  });

  it("resolves an allowed model", async () => {
    const { modelRuntime } = await createRuntime({ deny: ["local/alpha-2"] });
    const result = resolveCliModel({ cliModel: "local/alpha-1", modelRuntime });
    expect(result.model?.id).toBe("alpha-1");
    expect(result.error).toBeUndefined();
  });

  it("explains a denial for the /model command", async () => {
    const { modelRuntime } = await createRuntime({ deny: ["local/*"] });
    const denial = findModelPolicyDenial({
      reference: "alpha-1",
      policy: modelRuntime.getModelPolicy(),
      catalogModels: modelRuntime.getCatalogModels(),
    });
    expect(denial?.model.id).toBe("alpha-1");
    expect(denial?.message).toBe('denied by model policy pattern "local/*"');
  });
});

describe("model_policy tool", () => {
  async function createTool(deny: string[] = []) {
    const { modelRuntime } = await createRuntime({ deny });
    const settingsManager = SettingsManager.inMemory();
    const tool = wrapToolDefinition(
      createModelPolicyToolDefinition({
        settingsManager,
        modelRuntime,
        currentModel: () => modelRuntime.getModel("local", "alpha-1"),
      }),
    );
    return { tool, settingsManager, modelRuntime };
  }

  function text(result: { content: Array<{ type: string; text?: string }> }): string {
    return result.content.map((part) => part.text ?? "").join("\n");
  }

  it("lists the patterns and the models they hide", async () => {
    const { tool } = await createTool(["local/alpha-2"]);
    const result = await tool.execute("call-1", { action: "list" });
    expect(text(result)).toContain("deny: local/alpha-2");
    expect(text(result)).toContain("current: local/alpha-1 allowed");
    expect(text(result)).toContain("local/alpha-2 (local/alpha-2)");
  });

  it("hides a model for the next listing and reports the pattern", async () => {
    const { tool, modelRuntime, settingsManager } = await createTool();
    const result = await tool.execute("call-1", { action: "deny", pattern: "local/beta-1" });
    expect(text(result)).toContain('deny "local/beta-1"');
    expect(text(result)).toContain("local/beta-1 (local/beta-1)");
    expect(modelRuntime.getModels("local").map((entry) => entry.id)).toEqual([
      "alpha-1",
      "alpha-2",
    ]);
    expect(settingsManager.getGlobalSettings().modelPolicy).toEqual({ deny: ["local/beta-1"] });
  });

  it("refuses to deny the model the session is running", async () => {
    const { tool, modelRuntime, settingsManager } = await createTool();
    await expect(tool.execute("call-1", { action: "deny", pattern: "local/*" })).rejects.toThrow(
      "would disable local/alpha-1, the model this session is running",
    );
    expect(settingsManager.getGlobalSettings().modelPolicy).toBeUndefined();
    expect(modelRuntime.getModel("local", "alpha-1")).toBeDefined();
  });

  it("allows a hidden model again", async () => {
    const { tool, modelRuntime } = await createTool(["local/alpha-2"]);
    await tool.execute("call-1", { action: "allow", pattern: "local/alpha-2" });
    expect(modelRuntime.getModel("local", "alpha-2")).toBeDefined();
  });
});

describe("saveModelPolicy", () => {
  it("writes the setting and refreshes the catalog in one call", async () => {
    const { modelRuntime } = await createRuntime();
    const settingsManager = SettingsManager.inMemory();
    saveModelPolicy({ settingsManager, modelRuntime }, policy([], ["local/*"]));
    expect(settingsManager.getGlobalSettings().modelPolicy?.deny).toEqual(["local/*"]);
    expect(modelRuntime.getModels("local")).toEqual([]);
  });
});
