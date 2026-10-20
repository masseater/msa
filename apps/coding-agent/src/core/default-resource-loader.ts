import pathsModule from "../utils/paths.ts";
import DefaultPackageManager from "./default-package-manager.ts";
import DefaultResourceLoaderLayer8 from "./default-resource-loader-layer-8.ts";
import eventBusModule from "./event-bus.ts";
import loader from "./extensions/loader.ts";
import resourceLoader from "./resource-loader.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import SettingsManager from "./settings-manager.ts";

const { resolvePath } = pathsModule;
const { createEventBus } = eventBusModule;
const { isBuiltinExtension } = resourceLoader;
const { createExtensionRuntime } = loader;

export default class DefaultResourceLoader
  extends DefaultResourceLoaderLayer8
  implements resourceLoaderTypes.ResourceLoader
{
  constructor(options: resourceLoaderTypes.DefaultResourceLoaderOptions) {
    super();
    this.options = options;
    this.cwd = resolvePath(options.cwd);
    this.agentDir = resolvePath(options.agentDir);
    this.settingsManager =
      options.settingsManager ?? SettingsManager.create(this.cwd, this.agentDir);
    this.constructPart1(options);
    this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
    this.additionalSkillPaths = options.additionalSkillPaths ?? [];
    this.additionalPromptTemplatePaths = options.additionalPromptTemplatePaths ?? [];
    this.additionalThemePaths = options.additionalThemePaths ?? [];
    this.noExtensions = options.noExtensions ?? false;
    this.disabledBuiltinExtensions = new Set(options.disabledBuiltinExtensions);
    this.noSkills = options.noSkills ?? false;
    this.noPromptTemplates = options.noPromptTemplates ?? false;
    this.noThemes = options.noThemes ?? false;
    this.noContextFiles = options.noContextFiles ?? false;
    this.systemPromptSource = options.systemPrompt;
    this.appendSystemPromptSource = options.appendSystemPrompt;
    this.extensionsOverride = options.extensionsOverride;
    this.skillsOverride = options.skillsOverride;
    this.promptsOverride = options.promptsOverride;
    this.themesOverride = options.themesOverride;
    this.agentsFilesOverride = options.agentsFilesOverride;
    this.systemPromptOverride = options.systemPromptOverride;
    this.appendSystemPromptOverride = options.appendSystemPromptOverride;

    this.extensionsResult = { errors: [], extensions: [], runtime: createExtensionRuntime() };
    this.skills = [];
    this.skillDiagnostics = [];
    this.prompts = [];
    this.promptDiagnostics = [];
    this.themes = [];
    this.themeDiagnostics = [];
    this.agentsFiles = [];
    this.appendSystemPrompt = [];
    this.appendSystemPromptSourcePaths = [];
    this.lastSkillPaths = [];
    this.extensionSkillSourceInfos = new Map();
    this.extensionPromptSourceInfos = new Map();
    this.extensionThemeSourceInfos = new Map();
    this.resourceMetadataByPath = new Map();
    this.lastPromptPaths = [];
    this.lastThemePaths = [];
    this.loaded = false;
  }

  private constructPart1(options: resourceLoaderTypes.DefaultResourceLoaderOptions) {
    this.eventBus = options.eventBus ?? createEventBus();
    const factories = options.extensionFactories ?? [];
    this.extensionFactories = factories.filter((input) => !isBuiltinExtension(input));
    this.builtinExtensions = new Map(
      factories.filter(isBuiltinExtension).map((input) => [input.name, input]),
    );
    this.packageManager = new DefaultPackageManager({
      agentDir: this.agentDir,
      builtinExtensions: [...this.builtinExtensions.keys()],
      cwd: this.cwd,
      settingsManager: this.settingsManager,
    });
  }
}
