import type { Api, Model } from "@msa/ai";
import { describe, expect, it } from "vite-plus/test";

import {
  compareModelVersions,
  createUpgradeReplacements,
  findModelUpgrade,
  findModelUpgrades,
  parseModelIdVersion,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
} from "../src/core/model-upgrade.ts";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";
import type { Settings } from "../src/core/settings-schema.ts";
import { createModelUpgradeToolDefinition } from "../src/core/tools/model-upgrade.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";

function model(provider: string, id: string): Model<Api> {
  return { id, name: id, provider } as unknown as Model<Api>;
}

describe("model id versions", () => {
  it("reads the family, version, and dated variant", () => {
    expect(parseModelIdVersion("claude-sonnet-4-5")).toEqual({
      family: "claude-sonnet",
      version: [4, 5],
      variant: "",
      date: undefined,
    });
    expect(parseModelIdVersion("claude-sonnet-4-5-20250929")).toEqual({
      family: "claude-sonnet",
      version: [4, 5],
      variant: "",
      date: "20250929",
    });
    expect(parseModelIdVersion("deepseek-v4.1-flash-1017")).toEqual({
      family: "deepseek",
      version: [4, 1],
      variant: "flash",
      date: "1017",
    });
  });

  it("finds no version in an id whose digits belong to the family name", () => {
    expect(parseModelIdVersion("kimi-k2.6")).toBeUndefined();
    expect(parseModelIdVersion("kimi-k3")).toBeUndefined();
  });

  it("compares versions component by component", () => {
    expect(compareModelVersions([5, 5], [4, 5])).toBeGreaterThan(0);
    expect(compareModelVersions([4, 5], [4, 5, 1])).toBeLessThan(0);
    expect(compareModelVersions([4], [4, 0])).toBe(0);
  });
});

describe("findModelUpgrades", () => {
  it("upgrades a higher version of the same family and variant", () => {
    const candidates = findModelUpgrades([
      model("anthropic-api", "claude-sonnet-4-5"),
      model("anthropic-api", "claude-sonnet-5-5"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ confident: true });
    expect(candidates[0]!.from.id).toBe("claude-sonnet-4-5");
    expect(candidates[0]!.to.id).toBe("claude-sonnet-5-5");
  });

  it("upgrades an undated id to a dated variant of the same version", () => {
    const candidates = findModelUpgrades([
      model("deepseek", "deepseek-v4.1-flash"),
      model("deepseek", "deepseek-v4.1-flash-1017"),
    ]);
    expect(candidates.map((candidate) => [candidate.from.id, candidate.to.id])).toEqual([
      ["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017"],
    ]);
    expect(candidates[0]!.confident).toBe(true);
  });

  it("reports a different variant as a candidate without upgrading it", () => {
    const candidates = findModelUpgrades([
      model("openai", "gpt-5.5"),
      model("openai", "gpt-6.1-sol"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ confident: false });
    expect(createUpgradeReplacements(candidates).size).toBe(0);
  });

  it("leaves a family whose ids name no version alone", () => {
    expect(
      findModelUpgrades([model("moonshotai", "kimi-k2.6"), model("moonshotai", "kimi-k3")]),
    ).toEqual([]);
  });

  it("never upgrades across providers", () => {
    expect(
      findModelUpgrades([
        model("anthropic-api", "claude-sonnet-4-5"),
        model("openrouter", "claude-sonnet-5-5"),
      ]),
    ).toEqual([]);
  });

  it("names the upgrade a reference points at", () => {
    const candidates = findModelUpgrades([
      model("anthropic-api", "claude-sonnet-4-5"),
      model("anthropic-api", "claude-sonnet-5-5"),
    ]);
    expect(findModelUpgrade(candidates, "claude-sonnet-4-5")?.to.id).toBe("claude-sonnet-5-5");
    expect(findModelUpgrade(candidates, "anthropic-api/claude-sonnet-4-5")?.to.id).toBe(
      "claude-sonnet-5-5",
    );
    expect(findModelUpgrade(candidates, "claude-sonnet-5-5")).toBeUndefined();
  });
});

function upgradePair(): {
  candidates: ReturnType<typeof findModelUpgrades>;
} {
  return {
    candidates: findModelUpgrades([
      model("anthropic-api", "claude-sonnet-4-5"),
      model("anthropic-api", "claude-sonnet-5-5"),
    ]),
  };
}

function settingsNamingTheOldModel(): Settings {
  return {
    defaultProvider: "anthropic-api",
    defaultModel: "claude-sonnet-4-5",
    enabledModels: ["anthropic-api/claude-sonnet-4-5:high", "openai/gpt-5.5"],
    modelThinkingLevels: { "anthropic-api/claude-sonnet-4-5": "high" },
    modelPolicy: { allow: ["anthropic-api/*"], deny: ["anthropic-api/claude-sonnet-4-5"] },
    goal: { evaluatorModel: "anthropic-api/claude-sonnet-4-5" },
    orchestrator: { workerModel: "anthropic-api/claude-sonnet-4-5" },
    compaction: { modelOverrides: { "anthropic-api/claude-sonnet-4-5": { reserveTokens: 1 } } },
  } as Settings;
}

describe("rewriteModelReferencesInSettings", () => {
  it("replaces every reference that names the old model", () => {
    const { candidates } = upgradePair();
    const settings = settingsNamingTheOldModel();
    const changes = rewriteModelReferencesInSettings(
      settings,
      createUpgradeReplacements(candidates),
    );

    expect(settings.defaultModel).toBe("claude-sonnet-5-5");
    expect(settings.enabledModels).toEqual([
      "anthropic-api/claude-sonnet-5-5:high",
      "openai/gpt-5.5",
    ]);
    expect(settings.modelThinkingLevels).toEqual({ "anthropic-api/claude-sonnet-5-5": "high" });
    expect(settings.modelPolicy).toEqual({
      allow: ["anthropic-api/*"],
      deny: ["anthropic-api/claude-sonnet-5-5"],
    });
    expect(settings.goal?.evaluatorModel).toBe("anthropic-api/claude-sonnet-5-5");
    expect(settings.orchestrator?.workerModel).toBe("anthropic-api/claude-sonnet-5-5");
    expect(settings.compaction?.modelOverrides).toEqual({
      "anthropic-api/claude-sonnet-5-5": { reserveTokens: 1 },
    });
    expect(changes.map((change) => change.setting).sort()).toEqual([
      "compaction.modelOverrides key",
      "defaultModel",
      "enabledModels[]",
      "goal.evaluatorModel",
      "modelPolicy.deny[]",
      "modelThinkingLevels key",
      "orchestrator.workerModel",
    ]);
  });

  it("leaves settings that name other models alone", () => {
    const settings: Settings = {
      defaultProvider: "openai",
      defaultModel: "gpt-5.5",
      enabledModels: ["openai/*"],
    } as Settings;
    expect(
      rewriteModelReferencesInSettings(
        settings,
        createUpgradeReplacements(upgradePair().candidates),
      ),
    ).toEqual([]);
    expect(settings).toEqual({
      defaultProvider: "openai",
      defaultModel: "gpt-5.5",
      enabledModels: ["openai/*"],
    });
  });
});

describe("planModelUpgrades", () => {
  it("reports the changes without writing either layer", () => {
    const { candidates } = upgradePair();
    const global = settingsNamingTheOldModel();
    const project: Settings = {
      defaultProvider: "anthropic-api",
      defaultModel: "claude-sonnet-4-5",
    } as Settings;
    const plan = planModelUpgrades({ candidates, layers: { global, project } });

    expect(plan.changes.filter((change) => change.scope === "global").length).toBe(7);
    expect(plan.changes.filter((change) => change.scope === "project")).toEqual([
      {
        scope: "project",
        setting: "defaultModel",
        from: "claude-sonnet-4-5",
        to: "claude-sonnet-5-5",
      },
    ]);
    expect(global.defaultModel).toBe("claude-sonnet-4-5");
    expect(project.defaultModel).toBe("claude-sonnet-4-5");
    expect(plan.unreachable).toContain("Session transcripts keep the model id they recorded.");
  });
});

describe("settings", () => {
  it("writes the rewritten references into the agent-directory layer", async () => {
    const storage = new InMemorySettingsStorage();
    storage.withLock("global", () => JSON.stringify(settingsNamingTheOldModel()));
    const manager = SettingsManager.fromStorage(storage);
    const { candidates } = upgradePair();

    const written = manager.rewriteModelReferences((layer) =>
      rewriteModelReferencesInSettings(layer, createUpgradeReplacements(candidates)),
    );
    await manager.flush();

    expect(written.global).toHaveLength(7);
    expect(manager.getGlobalSettings().defaultModel).toBe("claude-sonnet-5-5");
    expect(manager.getGlobalSettings().enabledModels?.[1]).toBe("openai/gpt-5.5");
  });
});

describe("model_upgrade tool", () => {
  async function createTool() {
    const storage = new InMemorySettingsStorage();
    storage.withLock("global", () => JSON.stringify(settingsNamingTheOldModel()));
    const settingsManager = SettingsManager.fromStorage(storage);
    const { candidates } = upgradePair();
    const tool = wrapToolDefinition(
      createModelUpgradeToolDefinition({
        settingsManager,
        modelRuntime: {
          getCatalogModels: () => candidates.flatMap((candidate) => [candidate.from, candidate.to]),
        } as never,
      }),
    );
    return { tool, settingsManager };
  }

  function text(result: { content: Array<{ type: string; text?: string }> }): string {
    return result.content.map((part) => part.text ?? "").join("\n");
  }

  it("lists the changes without writing them", async () => {
    const { tool, settingsManager } = await createTool();
    const result = await tool.execute("call-1", { action: "list" });
    expect(text(result)).toContain(
      "anthropic-api/claude-sonnet-4-5 → anthropic-api/claude-sonnet-5-5",
    );
    expect(text(result)).toContain("global defaultModel: claude-sonnet-4-5 → claude-sonnet-5-5");
    expect(settingsManager.getGlobalSettings().defaultModel).toBe("claude-sonnet-4-5");
  });

  it("writes the changes when asked to apply", async () => {
    const { tool, settingsManager } = await createTool();
    const result = await tool.execute("call-1", { action: "apply" });
    expect(text(result)).toContain("Wrote 7 settings.");
    await settingsManager.flush();
    expect(settingsManager.getGlobalSettings().defaultModel).toBe("claude-sonnet-5-5");
  });
});
