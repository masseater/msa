import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import text from "../../utils/text.ts";
import FileSettingsStorage from "../file-settings-storage.ts";
import InMemorySettingsStorage from "../in-memory-settings-storage.ts";
import platformNode from "../platform-node.ts";
import settingsManagerHelpers from "../settings-manager-helpers.ts";
import type settingsManagerInternalTypes from "../settings-manager-internal.types.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { stripBom } = text;
const { deepMergeSettings, toSettingsError } = settingsManagerHelpers;
const { resolvePath } = pathsModule;
const { join } = platformNode;
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

function loadFromStorage(
  storage: settingsManagerTypes.SettingsStorage,
  scope: settingsManagerTypes.SettingsScope,
  projectTrusted = true,
): settingsSchemaTypes.Settings {
  if (scope === "project" && !projectTrusted) {
    return {};
  }

  let content: string | undefined;
  storage.withLock(scope, (current) => {
    content = current;
    return undefined;
  });

  if (content === undefined || content === "") {
    return {};
  }
  const settings = JSON.parse(stripBom(content));
  return migrateSettings(settings);
}

function tryLoadFromStorage(
  storage: settingsManagerTypes.SettingsStorage,
  scope: settingsManagerTypes.SettingsScope,
  projectTrusted = true,
): { settings: settingsSchemaTypes.Settings; error: Error | null } {
  try {
    return {
      error: null,
      settings: loadFromStorage(storage, scope, projectTrusted),
    };
  } catch (error) {
    return { error: error as Error, settings: {} };
  }
}

function loadState(
  storage: settingsManagerTypes.SettingsStorage,
  options: settingsManagerTypes.SettingsManagerCreateOptions,
  settingsPaths: settingsManagerInternalTypes.SettingsPaths = {},
): settingsManagerInternalTypes.SettingsState {
  const projectTrusted = options.projectTrusted ?? true;
  const globalLoad = tryLoadFromStorage(storage, "global");
  const projectLoad = tryLoadFromStorage(storage, "project", projectTrusted);
  const errors: settingsManagerTypes.SettingsError[] = [];
  if (globalLoad.error !== null) {
    errors.push(toSettingsError("global", globalLoad.error, settingsPaths.global));
  }
  if (projectLoad.error !== null) {
    errors.push(toSettingsError("project", projectLoad.error, settingsPaths.project));
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

function inMemoryStorage(
  settings: Partial<settingsSchemaTypes.Settings>,
): settingsManagerTypes.SettingsStorage {
  const storage = new InMemorySettingsStorage();
  const initialSettings = migrateSettings(structuredClone(settings) as Record<string, unknown>);
  storage.withLock("global", () => JSON.stringify(initialSettings, null, 2));
  return storage;
}

const mergeSettings = (
  base: settingsSchemaTypes.Settings,
  overrides: Partial<settingsSchemaTypes.Settings>,
): settingsSchemaTypes.Settings => deepMergeSettings(base, overrides);

const settingsLoading = {
  fileStorage,
  inMemoryStorage,
  loadFromStorage,
  loadState,
  mergeSettings,
  migrateLegacyFields,
  migrateSettings,
  tryLoadFromStorage,
};

export default settingsLoading;
