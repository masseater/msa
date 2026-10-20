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
import type { Settings } from "../src/core/settings-schema.ts";
import modelUpgradeSupport from "./model-upgrade-support.ts";

const { model, settingsNamingTheOldModel, upgradePair } = modelUpgradeSupport;

const readsTheFamilyVersionAndDatedVariant = () => {
  expect(parseModelIdVersion("claude-sonnet-4-5")).toEqual({
    date: undefined,
    family: "claude-sonnet",
    variant: "",
    version: [4, 5],
  });
  expect(parseModelIdVersion("claude-sonnet-4-5-20250929")).toEqual({
    date: "20250929",
    family: "claude-sonnet",
    variant: "",
    version: [4, 5],
  });
  expect(parseModelIdVersion("deepseek-v4.1-flash-1017")).toEqual({
    date: "1017",
    family: "deepseek",
    variant: "flash",
    version: [4, 1],
  });
};

const findsNoVersionInAnIdWhose = () => {
  expect(parseModelIdVersion("kimi-k2.6")).toBeUndefined();
  expect(parseModelIdVersion("kimi-k3")).toBeUndefined();
};

const comparesVersionsComponentByComponent = () => {
  expect(compareModelVersions([5, 5], [4, 5])).toBeGreaterThan(0);
  expect(compareModelVersions([4, 5], [4, 5, 1])).toBeLessThan(0);
  expect(compareModelVersions([4], [4, 0])).toBe(0);
};

describe("model id versions", () => {
  it("reads the family, version, and dated variant", readsTheFamilyVersionAndDatedVariant);

  it("finds no version in an id whose digits belong to the family name", findsNoVersionInAnIdWhose);

  it("compares versions component by component", comparesVersionsComponentByComponent);
});

const upgradesAHigherVersionOfTheSame = () => {
  const candidates = findModelUpgrades([
    model("anthropic-api", "claude-sonnet-4-5"),
    model("anthropic-api", "claude-sonnet-5-5"),
  ]);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({ confident: true });
  expect(candidates[0]!.from.id).toBe("claude-sonnet-4-5");
  expect(candidates[0]!.to.id).toBe("claude-sonnet-5-5");
};

const upgradesAnUndatedIdToADated = () => {
  const candidates = findModelUpgrades([
    model("deepseek", "deepseek-v4.1-flash"),
    model("deepseek", "deepseek-v4.1-flash-1017"),
  ]);
  expect(candidates.map((candidate) => [candidate.from.id, candidate.to.id])).toEqual([
    ["deepseek-v4.1-flash", "deepseek-v4.1-flash-1017"],
  ]);
  expect(candidates[0]!.confident).toBe(true);
};

const reportsADifferentVariantAsACandidate = () => {
  const candidates = findModelUpgrades([
    model("openai", "gpt-5.5"),
    model("openai", "gpt-6.1-sol"),
  ]);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({ confident: false });
  expect(createUpgradeReplacements(candidates).size).toBe(0);
};

const leavesAFamilyWhoseIdsNameNo = () => {
  expect(
    findModelUpgrades([model("moonshotai", "kimi-k2.6"), model("moonshotai", "kimi-k3")]),
  ).toEqual([]);
};

const neverUpgradesAcrossProviders = () => {
  expect(
    findModelUpgrades([
      model("anthropic-api", "claude-sonnet-4-5"),
      model("openrouter", "claude-sonnet-5-5"),
    ]),
  ).toEqual([]);
};

const namesTheUpgradeAReferencePointsAt = () => {
  const candidates = findModelUpgrades([
    model("anthropic-api", "claude-sonnet-4-5"),
    model("anthropic-api", "claude-sonnet-5-5"),
  ]);
  expect(findModelUpgrade(candidates, "claude-sonnet-4-5")?.to.id).toBe("claude-sonnet-5-5");
  expect(findModelUpgrade(candidates, "anthropic-api/claude-sonnet-4-5")?.to.id).toBe(
    "claude-sonnet-5-5",
  );
  expect(findModelUpgrade(candidates, "claude-sonnet-5-5")).toBeUndefined();
};

describe("findModelUpgrades", () => {
  it("upgrades a higher version of the same family and variant", upgradesAHigherVersionOfTheSame);

  it("upgrades an undated id to a dated variant of the same version", upgradesAnUndatedIdToADated);

  it(
    "reports a different variant as a candidate without upgrading it",
    reportsADifferentVariantAsACandidate,
  );

  it("leaves a family whose ids name no version alone", leavesAFamilyWhoseIdsNameNo);

  it("never upgrades across providers", neverUpgradesAcrossProviders);

  it("names the upgrade a reference points at", namesTheUpgradeAReferencePointsAt);
});

const replacesEveryReferenceThatNamesTheOld = () => {
  const { candidates } = upgradePair();
  const settings = settingsNamingTheOldModel();
  const changes = rewriteModelReferencesInSettings(settings, createUpgradeReplacements(candidates));

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
};

const leavesSettingsThatNameOtherModelsAlone = () => {
  const settings: Settings = {
    defaultModel: "gpt-5.5",
    defaultProvider: "openai",
    enabledModels: ["openai/*"],
  } as Settings;
  expect(
    rewriteModelReferencesInSettings(settings, createUpgradeReplacements(upgradePair().candidates)),
  ).toEqual([]);
  expect(settings).toEqual({
    defaultModel: "gpt-5.5",
    defaultProvider: "openai",
    enabledModels: ["openai/*"],
  });
};

describe("rewriteModelReferencesInSettings", () => {
  it("replaces every reference that names the old model", replacesEveryReferenceThatNamesTheOld);

  it("leaves settings that name other models alone", leavesSettingsThatNameOtherModelsAlone);
});

const reportsTheChangesWithoutWritingEitherLayer = () => {
  const { candidates } = upgradePair();
  const global = settingsNamingTheOldModel();
  const project: Settings = {
    defaultModel: "claude-sonnet-4-5",
    defaultProvider: "anthropic-api",
  } as Settings;
  const plan = planModelUpgrades({ candidates, layers: { global, project } });

  expect(plan.changes.filter((change) => change.scope === "global").length).toBe(7);
  expect(plan.changes.filter((change) => change.scope === "project")).toEqual([
    {
      from: "claude-sonnet-4-5",
      scope: "project",
      setting: "defaultModel",
      to: "claude-sonnet-5-5",
    },
  ]);
  expect(global.defaultModel).toBe("claude-sonnet-4-5");
  expect(project.defaultModel).toBe("claude-sonnet-4-5");
  expect(plan.unreachable).toContain("Session transcripts keep the model id they recorded.");
};

describe("planModelUpgrades", () => {
  it(
    "reports the changes without writing either layer",
    reportsTheChangesWithoutWritingEitherLayer,
  );
});
