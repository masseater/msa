import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import settingsManagerHelpers from "../settings-manager-helpers.ts";
import type settingsManagerInternalTypes from "../settings-manager-internal.types.ts";
import type SettingsManager from "../settings-manager.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";
import modifiedMerge from "./modified-merge.ts";
import settingsLoading from "./settings-loading.ts";

const { deepMergeSettings, toSettingsError } = settingsManagerHelpers;
const { mergeModifiedSettings } = modifiedMerge;
const { awaited, awaitingWith } = awaitingModule;

export default class SettingsPersistence {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
  }

  private modifiedFields = new Set<keyof settingsSchemaTypes.Settings>();

  private modifiedNestedFields = new Map<keyof settingsSchemaTypes.Settings, Set<string>>();

  private modifiedProjectFields = new Set<keyof settingsSchemaTypes.Settings>();

  private modifiedProjectNestedFields = new Map<keyof settingsSchemaTypes.Settings, Set<string>>();

  private writeQueue: Promise<void> = Promise.resolve();

  markModified(field: keyof settingsSchemaTypes.Settings, nestedKey?: string): void {
    this.modifiedFields.add(field);
    if (nestedKey !== undefined && nestedKey !== "") {
      if (!this.modifiedNestedFields.has(field)) {
        this.modifiedNestedFields.set(field, new Set());
      }
      this.modifiedNestedFields.get(field)!.add(nestedKey);
    }
  }

  markProjectModified(field: keyof settingsSchemaTypes.Settings, nestedKey?: string): void {
    this.modifiedProjectFields.add(field);
    if (nestedKey !== undefined && nestedKey !== "") {
      if (!this.modifiedProjectNestedFields.has(field)) {
        this.modifiedProjectNestedFields.set(field, new Set());
      }
      this.modifiedProjectNestedFields.get(field)!.add(nestedKey);
    }
  }

  private assertProjectTrustedForWrite(): void {
    if (!this.manager.projectTrusted) {
      throw new Error("Project is not trusted; refusing to write project settings");
    }
  }

  private recordError(scope: settingsManagerTypes.SettingsScope, error: unknown): void {
    this.manager.errors.push(toSettingsError(scope, error, this.manager.settingsPaths[scope]));
  }

  private clearModifiedScope(scope: settingsManagerTypes.SettingsScope): void {
    if (scope === "global") {
      this.modifiedFields.clear();
      this.modifiedNestedFields.clear();
      return;
    }

    this.modifiedProjectFields.clear();
    this.modifiedProjectNestedFields.clear();
  }

  private cloneModifiedNestedFields(
    source: Map<keyof settingsSchemaTypes.Settings, Set<string>>,
  ): Map<keyof settingsSchemaTypes.Settings, Set<string>> {
    const snapshot = new Map<keyof settingsSchemaTypes.Settings, Set<string>>();
    for (const [key, value] of source.entries()) {
      snapshot.set(key, new Set(value));
    }
    return snapshot;
  }

  setGlobalSetting<K extends keyof settingsSchemaTypes.Settings>(
    field: K,
    value: settingsSchemaTypes.Settings[K],
  ): void {
    this.manager.globalSettings[field] = value;
    this.markModified(field);
    this.save();
  }

  private enqueueWrite(scope: settingsManagerTypes.SettingsScope, task: () => Promise<void>): void {
    this.writeQueue = this.writeQueue
      .then(() => {
        if (scope === "project") {
          this.assertProjectTrustedForWrite();
        }
        return task();
      })
      .then(() => {
        this.clearModifiedScope(scope);
        return undefined;
      })
      .catch((error) => {
        this.recordError(scope, error);
      });
  }

  private persistScopedSettings(
    scope: settingsManagerTypes.SettingsScope,
    snapshotSettings: settingsSchemaTypes.Settings,
    modifiedFields: Set<keyof settingsSchemaTypes.Settings>,
    modifiedNestedFields: Map<keyof settingsSchemaTypes.Settings, Set<string>>,
  ): Promise<void> {
    return this.manager.storage.withLock(scope, (current) =>
      mergeModifiedSettings({
        current,
        fields: modifiedFields,
        nestedFields: modifiedNestedFields,
        snapshot: snapshotSettings,
      }),
    );
  }

  save(): void {
    this.manager.settings = deepMergeSettings(
      this.manager.globalSettings,
      this.manager.projectSettings,
    );

    if (this.manager.globalSettingsLoadError !== null) {
      return;
    }

    const snapshotGlobalSettings = structuredClone(this.manager.globalSettings);
    const modifiedFields = new Set(this.modifiedFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedNestedFields);

    this.enqueueWrite("global", () =>
      this.persistScopedSettings(
        "global",
        snapshotGlobalSettings,
        modifiedFields,
        modifiedNestedFields,
      ),
    );
  }

  setProjectTrusted(trusted: boolean): Promise<void> {
    if (this.manager.projectTrusted === trusted) {
      return Promise.resolve();
    }

    this.manager.projectTrusted = trusted;
    this.modifiedProjectFields.clear();
    this.modifiedProjectNestedFields.clear();

    if (!trusted) {
      this.manager.projectSettings = {};
      this.manager.projectSettingsLoadError = null;
      this.manager.settings = deepMergeSettings(
        this.manager.globalSettings,
        this.manager.projectSettings,
      );
      return Promise.resolve();
    }

    return settingsLoading
      .tryLoadFromStorage(this.manager.storage, "project", trusted)
      .then((projectLoad) => this.applyTrustedProjectLoad(projectLoad));
  }

  private applyTrustedProjectLoad(
    projectLoad: Awaited<ReturnType<typeof settingsLoading.tryLoadFromStorage>>,
  ): void {
    this.manager.projectSettings = projectLoad.settings;
    this.manager.projectSettingsLoadError = projectLoad.error;
    if (projectLoad.error !== null) {
      this.recordError("project", projectLoad.error);
    }
    this.manager.settings = deepMergeSettings(
      this.manager.globalSettings,
      this.manager.projectSettings,
    );
  }

  reload(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.writeQueue);
        const globalLoad = yield* awaited(
          settingsLoading.tryLoadFromStorage(this.manager.storage, "global"),
        );
        if (globalLoad.error === null) {
          this.manager.globalSettings = globalLoad.settings;
          this.manager.globalSettingsLoadError = null;
        } else {
          this.manager.globalSettingsLoadError = globalLoad.error;
          this.recordError("global", globalLoad.error);
        }

        this.modifiedFields.clear();
        this.modifiedNestedFields.clear();
        this.modifiedProjectFields.clear();
        this.modifiedProjectNestedFields.clear();

        const projectLoad = yield* awaited(
          settingsLoading.tryLoadFromStorage(
            this.manager.storage,
            "project",
            this.manager.projectTrusted,
          ),
        );
        if (projectLoad.error === null) {
          this.manager.projectSettings = projectLoad.settings;
          this.manager.projectSettingsLoadError = null;
        } else {
          this.manager.projectSettingsLoadError = projectLoad.error;
          this.recordError("project", projectLoad.error);
        }

        this.manager.settings = deepMergeSettings(
          this.manager.globalSettings,
          this.manager.projectSettings,
        );
      }, this),
    );
  }

  setNestedGlobalSetting<
    K extends settingsManagerInternalTypes.ObjectSettingKey,
    N extends keyof NonNullable<settingsSchemaTypes.Settings[K]> & string,
  >(field: K, key: N, value: NonNullable<settingsSchemaTypes.Settings[K]>[N]): void {
    this.manager.globalSettings[field] = {
      ...this.manager.globalSettings[field],
      [key]: value,
    } as NonNullable<settingsSchemaTypes.Settings[K]>;
    this.markModified(field, key);
    this.save();
  }

  saveProjectSettings(settings: settingsSchemaTypes.Settings): void {
    this.assertProjectTrustedForWrite();
    this.manager.projectSettings = structuredClone(settings);
    this.manager.settings = deepMergeSettings(
      this.manager.globalSettings,
      this.manager.projectSettings,
    );

    if (this.manager.projectSettingsLoadError !== null) {
      return;
    }

    const snapshotProjectSettings = structuredClone(this.manager.projectSettings);
    const modifiedFields = new Set(this.modifiedProjectFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedProjectNestedFields);
    this.enqueueWrite("project", () =>
      this.persistScopedSettings(
        "project",
        snapshotProjectSettings,
        modifiedFields,
        modifiedNestedFields,
      ),
    );
  }

  updateProjectSettings(
    field: keyof settingsSchemaTypes.Settings,
    update: (settings: settingsSchemaTypes.Settings) => void,
  ): void {
    this.assertProjectTrustedForWrite();
    const projectSettings = structuredClone(this.manager.projectSettings);
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
}
