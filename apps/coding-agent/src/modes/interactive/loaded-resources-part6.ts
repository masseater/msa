import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type promptTemplatesTypes from "../../core/prompt-templates.types.ts";
import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type skillsTypes from "../../core/skills.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";
import loadedResourcesPart5 from "./loaded-resources-part5.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";
import type themeTypes from "./theme/theme.types.ts";
const { buildSectionHeaderSectionHeaderPart14 } = loadedResourcesPart5;

function buildSectionHeaderSectionHeader(
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
  const {
    sectionHeader,
    sourceInfos,
    resourceLoader,
    addSection,
    skillsResult,
    extensions,
    promptsResult,
    extensionsResult,
    themesResult,
  } = buildSectionHeaderSectionHeaderPart1(source, options, container);
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

const loadedResourcesPart6 = {
  buildSectionHeaderSectionHeader,
};

export default loadedResourcesPart6;

function buildSectionHeaderSectionHeaderPart1(
  source: loadedResourcesTypes.LoadedResourcesSource,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  sectionHeader: any;
  sourceInfos: any;
  resourceLoader: any;
  addSection: any;
  skillsResult: any;
  extensions: any;
  promptsResult: any;
  extensionsResult: any;
  themesResult: any;
} {
  return buildSectionHeaderSectionHeaderPart14(source, options, container);
}
