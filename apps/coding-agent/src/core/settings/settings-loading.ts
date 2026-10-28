import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import text from "../../utils/text.ts";
import FileSettingsStorage from "../file-settings-storage.ts";
import InMemorySettingsStorage from "../in-memory-settings-storage.ts";
import platform from "../platform/index.ts";
import settingsManagerHelpers from "../settings-manager-helpers.ts";
import type settingsManagerInternalTypes from "../settings-manager-internal.types.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { stripBom } = text;
const { deepMergeSettings, removedSettingNotices, toSettingsError } = settingsManagerHelpers;
const { resolvePath } = pathsModule;
const { join } = platform;
const { getAgentDir, CONFIG_DIR_NAME } = config;

function migrateSettings(settings: Record<string, unknown>): settingsSchemaTypes.Settings {
  if ("queueMode" in settings && !("steeringMode" in settings)) {
    settings["steeringMode"] = settings["queueMode"];
    delete settings["queueMode"];
  }

  if (!("transport" in settings) && typeof settings["websockets"] === "boolean") {
    settings["transport"] = settings["websockets"] ? "websocket" : "sse";
    delete settings["websockets"];
  }

  if (
    "skills" in settings &&
    typeof settings["skills"] === "object" &&
    settings["skills"] !== null &&
    !Array.isArray(settings["skills"])
  ) {
    migrateLegacyFields(settings);
  }

  if (
    "retry" in settings &&
    typeof settings["retry"] === "object" &&
    settings["retry"] !== null &&
    !Array.isArray(settings["retry"])
  ) {
    const retrySettings = settings["retry"] as Record<string, unknown>;
    const providerSettings =
      typeof retrySettings["provider"] === "object" && retrySettings["provider"] !== null
        ? (retrySettings["provider"] as Record<string, unknown>)
        : undefined;
    if (
      typeof retrySettings["maxDelayMs"] === "number" &&
      (providerSettings?.["maxRetryDelayMs"] === undefined ||
        providerSettings?.["maxRetryDelayMs"] === null)
    ) {
      retrySettings["provider"] = {
        ...(providerSettings ?? {}),
        maxRetryDelayMs: retrySettings["maxDelayMs"],
      };
    }
    delete retrySettings["maxDelayMs"];
  }

  return settings as settingsSchemaTypes.Settings;
}

function migrateLegacyFields(settings: Record<string, unknown>) {
  const skillsSettings = settings["skills"] as {
    enableSkillCommands?: boolean;
    customDirectories?: unknown;
  };
  if (
    skillsSettings.enableSkillCommands !== undefined &&
    settings["enableSkillCommands"] === undefined
  ) {
    settings["enableSkillCommands"] = skillsSettings.enableSkillCommands;
  }
  if (
    Array.isArray(skillsSettings.customDirectories) &&
    skillsSettings.customDirectories.length > 0
  ) {
    settings["skills"] = skillsSettings.customDirectories;
  } else {
    delete settings["skills"];
  }
}

function parseStoredSettings(content: string | undefined): settingsSchemaTypes.Settings {
  if (content === undefined || content === "") {
    return {};
  }
  const settings = JSON.parse(stripBom(content));
  return migrateSettings(settings);
}

function loadFromStorage(
  storage: settingsManagerTypes.SettingsStorage,
  scope: settingsManagerTypes.SettingsScope,
  projectTrusted = true,
): Promise<settingsSchemaTypes.Settings> {
  if (scope === "project" && !projectTrusted) {
    return Promise.resolve({});
  }

  let content: string | undefined;
  return storage
    .withLock(scope, (current) => {
      content = current;
      return undefined;
    })
    .then(() => parseStoredSettings(content));
}

function tryLoadFromStorage(
  storage: settingsManagerTypes.SettingsStorage,
  scope: settingsManagerTypes.SettingsScope,
  projectTrusted = true,
): Promise<{ settings: settingsSchemaTypes.Settings; error: Error | null }> {
  return loadFromStorage(storage, scope, projectTrusted).then(
    (settings) => ({ error: null, settings }),
    (error: unknown) => ({ error: error as Error, settings: {} }),
  );
}

function loadState(
  storage: settingsManagerTypes.SettingsStorage,
  options: settingsManagerTypes.SettingsManagerCreateOptions,
  settingsPaths: settingsManagerInternalTypes.SettingsPaths = {},
): Promise<settingsManagerInternalTypes.SettingsState> {
  const projectTrusted = options.projectTrusted ?? true;
  return Promise.all([
    tryLoadFromStorage(storage, "global"),
    tryLoadFromStorage(storage, "project", projectTrusted),
  ]).then(([globalLoad, projectLoad]) =>
    stateFrom({ globalLoad, projectLoad, projectTrusted, settingsPaths, storage }),
  );
}

type LoadResult = { settings: settingsSchemaTypes.Settings; error: Error | null };

function stateFrom(parts: {
  readonly storage: settingsManagerTypes.SettingsStorage;
  readonly globalLoad: LoadResult;
  readonly projectLoad: LoadResult;
  readonly projectTrusted: boolean;
  readonly settingsPaths: settingsManagerInternalTypes.SettingsPaths;
}): settingsManagerInternalTypes.SettingsState {
  const { globalLoad, projectLoad, projectTrusted, settingsPaths, storage } = parts;
  const errors: settingsManagerTypes.SettingsError[] = [];
  if (globalLoad.error !== null) {
    errors.push(toSettingsError("global", globalLoad.error, settingsPaths.global));
  }
  if (projectLoad.error !== null) {
    errors.push(toSettingsError("project", projectLoad.error, settingsPaths.project));
  }
  for (const [scope, load] of [
    ["global", globalLoad],
    ["project", projectLoad],
  ] as const) {
    for (const notice of removedSettingNotices(load.settings, scope))
      errors.push({
        ...toSettingsError(scope, new Error(notice), settingsPaths[scope]),
        notice: true,
      });
  }
  return {
    errors,
    globalLoadError: globalLoad.error,
    globalSettings: globalLoad.settings,
    projectLoadError: projectLoad.error,
    projectSettings: projectLoad.settings,
    projectTrusted,
    settings: deepMergeSettings(globalLoad.settings, projectLoad.settings),
    settingsPaths,
    storage,
  };
}

function fileStorage(
  cwd: string,
  agentDir: string = getAgentDir(),
): {
  storage: settingsManagerTypes.SettingsStorage;
  paths: settingsManagerInternalTypes.SettingsPaths;
} {
  const resolvedCwd = resolvePath(cwd);
  const resolvedAgentDir = resolvePath(agentDir);
  return {
    paths: {
      global: join(resolvedAgentDir, "settings.json"),
      project: join(resolvedCwd, CONFIG_DIR_NAME, "settings.json"),
    },
    storage: new FileSettingsStorage(resolvedCwd, resolvedAgentDir),
  };
}

function inMemoryState(
  settings: Partial<settingsSchemaTypes.Settings>,
  options: settingsManagerTypes.SettingsManagerCreateOptions,
): settingsManagerInternalTypes.SettingsState {
  const initialSettings = migrateSettings(structuredClone(settings) as Record<string, unknown>);
  const content = JSON.stringify(initialSettings, null, 2);
  return stateFrom({
    globalLoad: { error: null, settings: parseStoredSettings(content) },
    projectLoad: { error: null, settings: {} },
    projectTrusted: options.projectTrusted ?? true,
    settingsPaths: {},
    storage: new InMemorySettingsStorage({ global: content }),
  });
}

function unloadedFileState(
  cwd: string,
  agentDir: string | undefined,
  options: settingsManagerTypes.SettingsManagerCreateOptions,
): settingsManagerInternalTypes.SettingsState {
  const { storage, paths } = fileStorage(cwd, agentDir);
  return stateFrom({
    globalLoad: { error: null, settings: {} },
    projectLoad: { error: null, settings: {} },
    projectTrusted: options.projectTrusted ?? true,
    settingsPaths: paths,
    storage,
  });
}

const mergeSettings = (
  base: settingsSchemaTypes.Settings,
  overrides: Partial<settingsSchemaTypes.Settings>,
): settingsSchemaTypes.Settings => deepMergeSettings(base, overrides);

const settingsLoading = {
  fileStorage,
  inMemoryState,
  loadFromStorage,
  loadState,
  mergeSettings,
  migrateLegacyFields,
  migrateSettings,
  tryLoadFromStorage,
  unloadedFileState,
};

export default settingsLoading;
