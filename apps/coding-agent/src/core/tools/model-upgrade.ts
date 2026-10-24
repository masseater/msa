import { Effect } from "effect";
import { Type } from "typebox";

import ask from "../ask.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import modelUpgradeModule from "../model-upgrade.ts";
import type modelUpgradeTypes from "./model-upgrade.types.ts";

const {
  candidatesNamedByChanges,
  createUpgradeReplacements,
  findModelUpgrade,
  findModelUpgrades,
  formatModelUpgrade,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
} = modelUpgradeModule;
const { readOnlyVariantOf } = ask;
const { awaited, awaiting } = awaitingModule;

const modelUpgradeSchema = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("apply")], {
    description:
      "list: show the upgrades and the settings they would change, writing nothing; apply: write the confident upgrades to settings",
  }),
  model: Type.Optional(
    Type.String({ description: "Limit to one model, as provider/model or a bare model id." }),
  ),
});

const modelUpgradeReadSchema = Type.Object({
  action: Type.Literal("list", {
    description: "list: show the upgrades and the settings they would change, writing nothing",
  }),
  model: Type.Optional(
    Type.String({ description: "Limit to one model, as provider/model or a bare model id." }),
  ),
});

const modelUpgradeToolSystemPromptContribution = {
  guidelines: [
    "Use model_upgrade with `list` before naming a model in a recommendation: a newer version of the same family may already exist",
    'Apply with `action: "apply"` only after reading the changes `list` reports; it rewrites defaultModel, enabledModels, modelThinkingLevels, modelPolicy, goal, decision, orchestrator, and compaction references in settings',
  ],
  snippet: "Find and apply catalog models a newer model replaces",
} as const;

function formatChanges(
  changes: readonly { scope: string; setting: string; from: string; to: string }[],
): string[] {
  return changes.map(
    (change) => `  ${change.scope} ${change.setting}: ${change.from} → ${change.to}`,
  );
}

type UpgradePlan = ReturnType<typeof planModelUpgrades>;

const textResult = (lines: readonly string[], details: Record<string, unknown>) => ({
  content: [{ text: lines.join("\n"), type: "text" as const }],
  details,
});

function reportLines(plan: UpgradePlan): string[] {
  const named = candidatesNamedByChanges(plan.candidates, plan.changes);
  const shown = named.length > 0 ? named : plan.candidates.slice(0, 20);
  const rest = plan.candidates.length - shown.length;
  return [
    "Upgrades",
    ...shown.map((candidate) => `  ${formatModelUpgrade(candidate)}`),
    ...(rest > 0 ? [`  ${rest} more catalog upgrades affect no setting`] : []),
    "Settings",
    ...(plan.changes.length === 0
      ? ["  No setting names an upgraded model."]
      : formatChanges(plan.changes)),
    "Not rewritten",
    ...plan.unreachable.map((line) => `  ${line}`),
  ];
}

function listResult(lines: string[], plan: UpgradePlan, applicable: number) {
  lines.push(
    applicable === 0
      ? "Nothing to apply; every upgrade needs a decision."
      : 'Dry run. Use action "apply" to write these settings.',
  );
  return textResult(lines, {
    action: "list",
    applicable,
    changes: plan.changes.length,
    upgrades: plan.candidates.length,
  });
}

const runModelUpgrade = (
  target: modelUpgradeTypes.ModelUpgradeToolTarget,
  params: modelUpgradeTypes.ModelUpgradeToolInput,
) =>
  awaiting(function* () {
    const { upgrades, candidates } = selectUpgrades(target, params);
    if (upgrades.length === 0) {
      return textResult(["No model upgrades found."], {
        action: params.action,
        changes: 0,
        upgrades: 0,
      });
    }
    const plan = planModelUpgrades({
      candidates,
      layers: {
        global: target.settingsManager.getGlobalSettings(),
        project: target.settingsManager.getProjectSettings(),
      },
      selected: upgrades,
    });
    const applicable = plan.candidates.filter((candidate) => candidate.confident);
    const lines = reportLines(plan);
    if (params.action !== "apply") return listResult(lines, plan, applicable.length);
    if (applicable.length === 0) {
      return textResult(lines, { action: "apply", changes: 0, upgrades: plan.candidates.length });
    }
    const replacements = createUpgradeReplacements(applicable);
    const count = yield* applyUpgrades(target, replacements, lines);
    return textResult(lines, {
      action: "apply",
      applied: [...replacements.keys()],
      changes: count,
      upgrades: plan.candidates.length,
    });
  });

function createModelUpgradeToolDefinition(
  target: modelUpgradeTypes.ModelUpgradeToolTarget,
): extensionsTypesTypes.ToolDefinition<typeof modelUpgradeSchema, Record<string, unknown>> {
  const modelUpgrade: extensionsTypesTypes.ToolDefinition<
    typeof modelUpgradeSchema,
    Record<string, unknown>
  > = {
    description:
      "Find catalog models that a newer model of the same family and variant replaces, and apply them to settings. A higher version or a later dated variant is confident; a different variant is only a candidate. `list` reports the settings that would change without writing; `apply` rewrites defaultModel, enabledModels, modelThinkingLevels, modelPolicy, goal, decision, orchestrator, and compaction references in agent-directory and project settings. Session transcripts keep their recorded model id.",
    execute: (_toolCallId, params) => Effect.runPromise(runModelUpgrade(target, params)),
    label: "model upgrade",
    name: "model_upgrade",
    parameters: modelUpgradeSchema,
    promptGuidelines: [...modelUpgradeToolSystemPromptContribution.guidelines],
    promptSnippet: modelUpgradeToolSystemPromptContribution.snippet,
  };
  return withReadOnlyVariant(modelUpgrade);
}

const modelUpgrade = {
  createModelUpgradeToolDefinition,
  modelUpgradeSchema,
  modelUpgradeToolSystemPromptContribution,
};

export default modelUpgrade;

function withReadOnlyVariant(
  definition: extensionsTypesTypes.ToolDefinition<
    Type.TObject<{
      action: Type.TUnion<[Type.TLiteral<"list">, Type.TLiteral<"apply">]>;
      model: Type.TOptional<Type.TString>;
    }>,
    Record<string, unknown>,
    any
  >,
): extensionsTypesTypes.ToolDefinition<
  Type.TObject<{
    action: Type.TUnion<[Type.TLiteral<"list">, Type.TLiteral<"apply">]>;
    model: Type.TOptional<Type.TString>;
  }>,
  Record<string, unknown>,
  any
> {
  return {
    ...definition,
    readOnlyVariant: readOnlyVariantOf(definition, {
      actions: ["list"],
      description:
        "Find catalog models that a newer model of the same family and variant replaces, and the settings that would change. Applying the upgrades is not available here.",
      parameters: modelUpgradeReadSchema,
      promptSnippet: "Find catalog models a newer model replaces",
    }),
  };
}

function selectUpgrades(
  target: modelUpgradeTypes.ModelUpgradeToolTarget,
  params: { model?: string; action: "list" | "apply" },
) {
  const candidates = findModelUpgrades(target.modelRuntime.getCatalogModels());
  const selected =
    params.model !== undefined && params.model !== ""
      ? [findModelUpgrade(candidates, params.model)]
      : candidates;
  if (selected.some((candidate) => candidate === undefined)) {
    throw new Error(`No upgrade found for "${params.model}".`);
  }
  const upgrades = selected.filter((candidate) => candidate !== undefined);
  return { candidates, upgrades };
}

function* applyUpgrades(
  target: modelUpgradeTypes.ModelUpgradeToolTarget,
  replacements: Map<string, string>,
  lines: string[],
) {
  const written = target.settingsManager.models.rewriteModelReferences((layer) =>
    rewriteModelReferencesInSettings(layer, replacements),
  );
  yield* awaited(target.settingsManager.persistence.flush());
  const count = written.global.length + written.project.length;
  lines.push(
    count === 0 ? "No setting changed." : `Wrote ${count} setting${count === 1 ? "" : "s"}.`,
  );
  return count;
}
