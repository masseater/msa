import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type promptTemplatesTypes from "../../core/prompt-templates.types.ts";
import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type skillsTypes from "../../core/skills.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";
import loadedResourcesPart3 from "./loaded-resources-part3.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";
import type themeTypes from "./theme/theme.types.ts";
const { buildSectionHeaderSectionHeaderSectionHeaderPart15 } = loadedResourcesPart3;

function buildSectionHeaderSectionHeaderSectionHeader(
  source: loadedResourcesTypes.LoadedResourcesSource,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  sectionHeader: (name: string, color: themeTypes.ThemeColor) => string;
  sourceInfos: Map<string, sourceInfoTypes.SourceInfo>;
  resourceLoader: Pick<
    resourceLoaderTypes.ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >;
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void;
  skillsResult: {
    skills: skillsTypes.Skill[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  };
  extensions: readonly loadedResourcesTypes.ResourceItem[];
  promptsResult: {
    prompts: promptTemplatesTypes.PromptTemplate[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  };
  extensionsResult: extensionsTypesTypes.LoadExtensionsResult;
  themesResult: {
    themes: themeTypes.Theme[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  };
} {
  const { resourceLoader } = source;
  const {
    addSection,
    extensions,
    extensionsResult,
    promptsResult,
    sectionHeader,
    skillsResult,
    sourceInfos,
    themesResult,
  } = buildSectionHeaderSectionHeaderSectionHeaderPart1(resourceLoader, options, container);
  return {
    addSection,
    extensions,
    extensionsResult,
    promptsResult,
    resourceLoader,
    sectionHeader,
    skillsResult,
    sourceInfos,
    themesResult,
  };
}

const loadedResourcesPart4 = {
  buildSectionHeaderSectionHeaderSectionHeader,
};

export default loadedResourcesPart4;

function buildSectionHeaderSectionHeaderSectionHeaderPart1(
  resourceLoader: Pick<
    resourceLoaderTypes.ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  addSection: any;
  extensions: any;
  extensionsResult: any;
  promptsResult: any;
  sectionHeader: any;
  skillsResult: any;
  sourceInfos: any;
  themesResult: any;
} {
  return buildSectionHeaderSectionHeaderSectionHeaderPart15(resourceLoader, options, container);
}
