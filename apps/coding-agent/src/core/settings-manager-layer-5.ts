import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import settingsManagerHelpers from "./settings-manager-helpers.ts";
import type settingsManagerInternalTypes from "./settings-manager-internal.types.ts";
import SettingsManagerLayer4 from "./settings-manager-layer-4.ts";
import SettingsManager from "./settings-manager.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { DEFAULT_COMPACTION_TOKEN_SETTINGS, deepMergeSettings, isMergeableObject, toSettingsError } =
  settingsManagerHelpers;

export default abstract class SettingsManagerLayer5 extends SettingsManagerLayer4 {
  static fromStorageWithPaths(
    storage: settingsManagerTypes.SettingsStorage,
    options: settingsManagerTypes.SettingsManagerCreateOptions,
    settingsPaths: settingsManagerInternalTypes.SettingsPaths = {},
  ): SettingsManager {
    const projectTrusted = options.projectTrusted ?? true;
    const globalLoad = SettingsManager.tryLoadFromStorage(storage, "global");
    const projectLoad = SettingsManager.tryLoadFromStorage(storage, "project", projectTrusted);
    const initialErrors: settingsManagerTypes.SettingsError[] = [];
    if (globalLoad.error !== null) {
      initialErrors.push(toSettingsError("global", globalLoad.error, settingsPaths.global));
    }
    if (projectLoad.error !== null) {
      initialErrors.push(toSettingsError("project", projectLoad.error, settingsPaths.project));
    }

    return new SettingsManager(
      storage,
      globalLoad.settings,
      projectLoad.settings,
      globalLoad.error,
      projectLoad.error,
      initialErrors,
      projectTrusted,
      settingsPaths,
    );
  }

  reload(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.writeQueue);
        const globalLoad = SettingsManager.tryLoadFromStorage(this.storage, "global");
        if (globalLoad.error === null) {
          this.globalSettings = globalLoad.settings;
          this.globalSettingsLoadError = null;
        } else {
          this.globalSettingsLoadError = globalLoad.error;
          this.recordError("global", globalLoad.error);
        }

        this.modifiedFields.clear();
        this.modifiedNestedFields.clear();
        this.modifiedProjectFields.clear();
        this.modifiedProjectNestedFields.clear();

        const projectLoad = SettingsManager.tryLoadFromStorage(
          this.storage,
          "project",
          this.projectTrusted,
        );
        if (projectLoad.error === null) {
          this.projectSettings = projectLoad.settings;
          this.projectSettingsLoadError = null;
        } else {
          this.projectSettingsLoadError = projectLoad.error;
          this.recordError("project", projectLoad.error);
        }

        this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
      }, this),
    );
  }

  protected setNestedGlobalSetting<
    K extends settingsManagerInternalTypes.ObjectSettingKey,
    N extends keyof NonNullable<settingsSchemaTypes.Settings[K]> & string,
  >(field: K, key: N, value: NonNullable<settingsSchemaTypes.Settings[K]>[N]): void {
    const group: NonNullable<settingsSchemaTypes.Settings[K]> =
      this.globalSettings[field] ?? ({} as NonNullable<settingsSchemaTypes.Settings[K]>);
    (group as Record<string, unknown>)[key] = value;
    this.globalSettings[field] = group;
    this.markModified(field, key);
    this.save();
  }

  protected saveProjectSettings(settings: settingsSchemaTypes.Settings): void {
    this.assertProjectTrustedForWrite();
    this.projectSettings = structuredClone(settings);
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);

    if (this.projectSettingsLoadError !== null) {
      return;
    }

    const snapshotProjectSettings = structuredClone(this.projectSettings);
    const modifiedFields = new Set(this.modifiedProjectFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedProjectNestedFields);
    this.enqueueWrite("project", () => {
      this.persistScopedSettings(
        "project",
        snapshotProjectSettings,
        modifiedFields,
        modifiedNestedFields,
      );
    });
  }

  protected updateProjectSettings(
    field: keyof settingsSchemaTypes.Settings,
    update: (settings: settingsSchemaTypes.Settings) => void,
  ): void {
    this.assertProjectTrustedForWrite();
    const projectSettings = structuredClone(this.projectSettings);
    update(projectSettings);
    this.markProjectModified(field);
    this.saveProjectSettings(projectSettings);
  }

  flush(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.writeQueue);
      }, this),
    );
  }

  setCompactionEnabled(enabled: boolean): void {
    this.setNestedGlobalSetting("compaction", "enabled", enabled);
  }

  protected getCompactionTokenSetting(
    field: keyof settingsSchemaTypes.CompactionModelOverride,
    model?: Pick<aiTypes.Model<string>, "provider" | "id">,
  ): number {
    const compaction = this.settings.compaction;
    const ordinary = compaction?.[field];
    if (
      ordinary !== undefined &&
      (typeof ordinary !== "number" || !Number.isSafeInteger(ordinary) || ordinary < 0)
    ) {
      throw new Error(
        `Invalid compaction.${field} setting: ${String(ordinary)}. Expected a non-negative safe integer.`,
      );
    }

    const modelKey = model === undefined ? undefined : `${model.provider}/${model.id}`;
    const entry = modelKey === undefined ? undefined : compaction?.modelOverrides?.[modelKey];
    if (entry !== undefined && !isMergeableObject(entry)) {
      throw new Error(
        `Invalid compaction.modelOverrides["${modelKey}"] setting: ${String(entry)}. Expected an object.`,
      );
    }
    const override = entry?.[field];
    if (
      override !== undefined &&
      (typeof override !== "number" || !Number.isSafeInteger(override) || override < 0)
    ) {
      throw new Error(
        `Invalid compaction.modelOverrides["${modelKey}"].${field} setting: ${String(override)}. Expected a non-negative safe integer.`,
      );
    }
    return override ?? ordinary ?? DEFAULT_COMPACTION_TOKEN_SETTINGS[field];
  }

  getCompactionReserveTokens(model?: Pick<aiTypes.Model<string>, "provider" | "id">): number {
    return this.getCompactionTokenSetting("reserveTokens", model);
  }

  getCompactionKeepRecentTokens(model?: Pick<aiTypes.Model<string>, "provider" | "id">): number {
    return this.getCompactionTokenSetting("keepRecentTokens", model);
  }

  setRetryEnabled(enabled: boolean): void {
    this.setNestedGlobalSetting("retry", "enabled", enabled);
  }

  setProjectPackages(packages: settingsSchemaTypes.PackageSource[]): void {
    this.updateProjectSettings("packages", (settings) => {
      settings.packages = packages;
    });
  }

  setProjectExtensionPaths(paths: string[]): void {
    this.updateProjectSettings("extensions", (settings) => {
      settings.extensions = paths;
    });
  }

  setProjectSkillPaths(paths: string[]): void {
    this.updateProjectSettings("skills", (settings) => {
      settings.skills = paths;
    });
  }

  setProjectPromptTemplatePaths(paths: string[]): void {
    this.updateProjectSettings("prompts", (settings) => {
      settings.prompts = paths;
    });
  }

  setProjectThemePaths(paths: string[]): void {
    this.updateProjectSettings("themes", (settings) => {
      settings.themes = paths;
    });
  }

  setShowImages(show: boolean): void {
    this.setNestedGlobalSetting("terminal", "showImages", show);
  }

  setImageWidthCells(width: number): void {
    this.setNestedGlobalSetting("terminal", "imageWidthCells", Math.max(1, Math.floor(width)));
  }

  setClearOnShrink(enabled: boolean): void {
    this.setNestedGlobalSetting("terminal", "clearOnShrink", enabled);
  }

  setShowTerminalProgress(enabled: boolean): void {
    this.setNestedGlobalSetting("terminal", "showTerminalProgress", enabled);
  }

  setImageAutoResize(enabled: boolean): void {
    this.setNestedGlobalSetting("images", "autoResize", enabled);
  }

  setBlockImages(blocked: boolean): void {
    this.setNestedGlobalSetting("images", "blockImages", blocked);
  }

  rewriteModelReferences<TChange>(rewrite: (settings: settingsSchemaTypes.Settings) => TChange[]): {
    global: TChange[];
    project: TChange[];
  } {
    const rewriteLayer = (
      scope: settingsManagerTypes.SettingsScope,
      current: settingsSchemaTypes.Settings,
      apply: (settings: settingsSchemaTypes.Settings) => void,
    ): TChange[] => {
      const next = structuredClone(current) as Record<string, unknown>;
      const changes = rewrite(next as settingsSchemaTypes.Settings);
      if (changes.length === 0) return changes;
      for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
        if (JSON.stringify((current as Record<string, unknown>)[key]) === JSON.stringify(next[key]))
          continue;
        if (scope === "global") this.markModified(key as keyof settingsSchemaTypes.Settings);
        else this.markProjectModified(key as keyof settingsSchemaTypes.Settings);
      }
      apply(next as settingsSchemaTypes.Settings);
      return changes;
    };

    const global = rewriteLayer("global", this.globalSettings, (settings) => {
      this.globalSettings = settings;
      this.save();
    });
    const project = this.projectTrusted
      ? rewriteLayer("project", this.projectSettings, (settings) =>
          this.saveProjectSettings(settings),
        )
      : [];
    return { global, project };
  }

  setMermaidRenderingMode(mode: settingsSchemaTypes.MermaidRenderingMode): void {
    this.setNestedGlobalSetting("markdown", "mermaid", mode);
  }
}
