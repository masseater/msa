import pathsModule from "../../utils/paths.ts";
import settingsDefaults from "../settings-defaults.ts";
import settingsManagerHelpers from "../settings-manager-helpers.ts";
import type SettingsManager from "../settings-manager.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { resolveDefaultTools } = settingsManagerHelpers;
const { SETTINGS_DEFAULTS } = settingsDefaults;
const { normalizePath } = pathsModule;

export default class ResourceSettings {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
  }

  getShellCommandPrefix(): string | undefined {
    return this.manager.settings.shellCommandPrefix;
  }

  getNpmCommand(): string[] | undefined {
    return this.manager.settings.npmCommand === undefined
      ? undefined
      : [...this.manager.settings.npmCommand];
  }

  getPackages(): settingsSchemaTypes.PackageSource[] {
    return [...(this.manager.settings.packages ?? [])];
  }

  getExtensionPaths(): string[] {
    return [...(this.manager.settings.extensions ?? [])];
  }

  getSkillPaths(): string[] {
    return [...(this.manager.settings.skills ?? [])];
  }

  getPromptTemplatePaths(): string[] {
    return [...(this.manager.settings.prompts ?? [])];
  }

  getThemePaths(): string[] {
    return [...(this.manager.settings.themes ?? [])];
  }

  getDefaultTools(): string[] | undefined {
    const tools = this.manager.settings.defaultTools;
    if (tools === undefined) return undefined;
    return resolveDefaultTools(
      Array.isArray(tools) ? tools.filter((tool) => typeof tool === "string") : [],
    );
  }

  getShellPath(): string | undefined {
    const shellPath = this.manager.settings.shellPath;
    return shellPath !== undefined && shellPath !== "" ? normalizePath(shellPath) : shellPath;
  }

  getEnableSkillCommands(): boolean {
    return this.manager.settings.enableSkillCommands ?? SETTINGS_DEFAULTS.enableSkillCommands;
  }

  setShellPath(path: string | undefined): void {
    this.manager.persistence.setGlobalSetting("shellPath", path);
  }

  setShellCommandPrefix(prefix: string | undefined): void {
    this.manager.persistence.setGlobalSetting("shellCommandPrefix", prefix);
  }

  setNpmCommand(command: string[] | undefined): void {
    this.manager.persistence.setGlobalSetting(
      "npmCommand",
      command === undefined ? undefined : [...command],
    );
  }

  setPackages(packages: settingsSchemaTypes.PackageSource[]): void {
    this.manager.persistence.setGlobalSetting("packages", packages);
  }

  setExtensionPaths(paths: string[]): void {
    this.manager.persistence.setGlobalSetting("extensions", paths);
  }

  setSkillPaths(paths: string[]): void {
    this.manager.persistence.setGlobalSetting("skills", paths);
  }

  setPromptTemplatePaths(paths: string[]): void {
    this.manager.persistence.setGlobalSetting("prompts", paths);
  }

  setThemePaths(paths: string[]): void {
    this.manager.persistence.setGlobalSetting("themes", paths);
  }

  setEnableSkillCommands(enabled: boolean): void {
    this.manager.persistence.setGlobalSetting("enableSkillCommands", enabled);
  }

  setProjectPackages(packages: settingsSchemaTypes.PackageSource[]): void {
    this.manager.persistence.updateProjectSettings("packages", (settings) => {
      settings.packages = packages;
    });
  }

  setProjectExtensionPaths(paths: string[]): void {
    this.manager.persistence.updateProjectSettings("extensions", (settings) => {
      settings.extensions = paths;
    });
  }

  setProjectSkillPaths(paths: string[]): void {
    this.manager.persistence.updateProjectSettings("skills", (settings) => {
      settings.skills = paths;
    });
  }

  setProjectPromptTemplatePaths(paths: string[]): void {
    this.manager.persistence.updateProjectSettings("prompts", (settings) => {
      settings.prompts = paths;
    });
  }

  setProjectThemePaths(paths: string[]): void {
    this.manager.persistence.updateProjectSettings("themes", (settings) => {
      settings.themes = paths;
    });
  }
}
