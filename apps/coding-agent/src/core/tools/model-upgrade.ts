import { type Static, Type } from "typebox";

import { readOnlyVariantOf } from "../ask.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import {
  candidatesNamedByChanges,
  createUpgradeReplacements,
  findModelUpgrade,
  findModelUpgrades,
  formatModelUpgrade,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
} from "../model-upgrade.ts";
import type { SettingsManager } from "../settings-manager.ts";

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

export type ModelUpgradeToolInput = Static<typeof modelUpgradeSchema>;

export const modelUpgradeToolSystemPromptContribution = {
  guidelines: [
    "Use model_upgrade with `list` before naming a model in a recommendation: a newer version of the same family may already exist",
    'Apply with `action: "apply"` only after reading the changes `list` reports; it rewrites defaultModel, enabledModels, modelThinkingLevels, modelPolicy, goal, orchestrator, and compaction references in settings',
  ],
  snippet: "Find and apply catalog models a newer model replaces",
} as const;

export interface ModelUpgradeToolTarget {
  settingsManager: SettingsManager;
  modelRuntime: ModelRuntime;
}

function formatChanges(
  changes: readonly { scope: string; setting: string; from: string; to: string }[],
): string[] {
  return changes.map(
    (change) => `  ${change.scope} ${change.setting}: ${change.from} → ${change.to}`,
  );
}

export function createModelUpgradeToolDefinition(
  target: ModelUpgradeToolTarget,
): ToolDefinition<typeof modelUpgradeSchema, Record<string, unknown>> {
  const modelUpgrade: ToolDefinition<typeof modelUpgradeSchema, Record<string, unknown>> = {
    description:
      "Find catalog models that a newer model of the same family and variant replaces, and apply them to settings. A higher version or a later dated variant is confident; a different variant is only a candidate. `list` reports the settings that would change without writing; `apply` rewrites defaultModel, enabledModels, modelThinkingLevels, modelPolicy, goal, orchestrator, and compaction references in agent-directory and project settings. Session transcripts keep their recorded model id.",
    async execute(_toolCallId, params) {
      const candidates = findModelUpgrades(target.modelRuntime.getCatalogModels());
      const selected = params.model ? [findModelUpgrade(candidates, params.model)] : candidates;
      if (selected.some((candidate) => candidate === undefined)) {
        throw new Error(`No upgrade found for "${params.model}".`);
      }
      const upgrades = selected.filter((candidate) => candidate !== undefined);
      if (upgrades.length === 0) {
        return {
          content: [{ type: "text", text: "No model upgrades found." }],
          details: { action: params.action, upgrades: 0, changes: 0 },
        };
      }

      const plan = planModelUpgrades({
        candidates,
        selected: upgrades,
        layers: {
          global: target.settingsManager.getGlobalSettings(),
          project: target.settingsManager.getProjectSettings(),
        },
      });
      const applicable = plan.candidates.filter((candidate) => candidate.confident);
      const named = candidatesNamedByChanges(plan.candidates, plan.changes);
      const shown = named.length > 0 ? named : plan.candidates.slice(0, 20);
      const rest = plan.candidates.length - shown.length;
      const lines = [
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

      if (params.action !== "apply") {
        lines.push(
          applicable.length === 0
            ? "Nothing to apply; every upgrade needs a decision."
            : 'Dry run. Use action "apply" to write these settings.',
        );
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            action: "list",
            upgrades: plan.candidates.length,
            applicable: applicable.length,
            changes: plan.changes.length,
          },
        };
      }

      if (applicable.length === 0) {
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { action: "apply", upgrades: plan.candidates.length, changes: 0 },
        };
      }

      const replacements = createUpgradeReplacements(applicable);
      const written = target.settingsManager.rewriteModelReferences((layer) =>
        rewriteModelReferencesInSettings(layer, replacements),
      );
      await target.settingsManager.flush();
      const count = written.global.length + written.project.length;
      lines.push(
        count === 0 ? "No setting changed." : `Wrote ${count} setting${count === 1 ? "" : "s"}.`,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          action: "apply",
          upgrades: plan.candidates.length,
          changes: count,
          applied: [...replacements.keys()],
        },
      };
    },
    label: "model upgrade",
    name: "model_upgrade",
    parameters: modelUpgradeSchema,
    promptGuidelines: [...modelUpgradeToolSystemPromptContribution.guidelines],
    promptSnippet: modelUpgradeToolSystemPromptContribution.snippet,
  };
  return {
    ...modelUpgrade,
    readOnlyVariant: readOnlyVariantOf(modelUpgrade, {
      actions: ["list"],
      description:
        "Find catalog models that a newer model of the same family and variant replaces, and the settings that would change. Applying the upgrades is not available here.",
      parameters: modelUpgradeReadSchema,
      promptSnippet: "Find catalog models a newer model replaces",
    }),
  };
}
