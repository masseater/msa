import type themeTypes from "../modes/interactive/theme/theme.types.ts";
import type DefaultResourceLoaderClass from "./default-resource-loader.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import type eventBusTypes from "./event-bus.types.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type skillsTypes from "./skills.types.ts";

declare namespace resourceLoaderTypes {
  interface ResourceExtensionPaths {
    skillPaths?: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>;
    promptPaths?: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>;
    themePaths?: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>;
  }

  interface ResourceLoaderReloadOptions {
    resolveProjectTrust?: (input: {
      extensionsResult: extensionsTypesTypes.LoadExtensionsResult;
    }) => Promise<boolean>;
  }

  interface ResourceLoader {
    getExtensions(): extensionsTypesTypes.LoadExtensionsResult;
    getSkills(): {
      skills: skillsTypes.Skill[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    };
    getPrompts(): {
      prompts: promptTemplatesTypes.PromptTemplate[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    };
    getThemes(): { themes: themeTypes.Theme[]; diagnostics: diagnosticsTypes.ResourceDiagnostic[] };
    getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
    getSystemPrompt(): string | undefined;
    getSystemPromptSource(): { path: string } | undefined;
    getAppendSystemPrompt(): string[];
    getAppendSystemPromptSources(): Array<{ path: string }>;
    extendResources(paths: ResourceExtensionPaths): void | Promise<void>;
    reload(options?: ResourceLoaderReloadOptions): Promise<void>;
  }

  interface DefaultResourceLoaderOptions {
    cwd: string;
    agentDir: string;
    settingsManager?: settingsManagerTypes.SettingsManager | undefined;
    eventBus?: eventBusTypes.EventBus | undefined;
    additionalExtensionPaths?: string[] | undefined;
    additionalSkillPaths?: string[] | undefined;
    additionalPromptTemplatePaths?: string[] | undefined;
    additionalThemePaths?: string[] | undefined;
    extensionFactories?: extensionsTypesTypes.InlineExtension[] | undefined;
    noExtensions?: boolean | undefined;
    disabledBuiltinExtensions?: string[] | undefined;
    noSkills?: boolean | undefined;
    noPromptTemplates?: boolean | undefined;
    noThemes?: boolean | undefined;
    noContextFiles?: boolean | undefined;
    systemPrompt?: string | undefined;
    appendSystemPrompt?: string[] | undefined;
    extensionsOverride?:
      | ((
          base: extensionsTypesTypes.LoadExtensionsResult,
        ) => extensionsTypesTypes.LoadExtensionsResult)
      | undefined;
    skillsOverride?: (base: {
      skills: skillsTypes.Skill[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    }) => {
      skills: skillsTypes.Skill[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    };
    promptsOverride?: (base: {
      prompts: promptTemplatesTypes.PromptTemplate[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    }) => {
      prompts: promptTemplatesTypes.PromptTemplate[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    };
    themesOverride?: (base: {
      themes: themeTypes.Theme[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    }) => {
      themes: themeTypes.Theme[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    };
    agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
      agentsFiles: Array<{ path: string; content: string }>;
    };
    systemPromptOverride?: (base: string | undefined) => string | undefined;
    appendSystemPromptOverride?: ((base: string[]) => string[]) | undefined;
  }

  type DefaultResourceLoader = (typeof DefaultResourceLoaderClass)["prototype"];

  type ResourceCollision = diagnosticsTypes.ResourceCollision;

  type ResourceDiagnostic = diagnosticsTypes.ResourceDiagnostic;
}

export type { resourceLoaderTypes as default };
