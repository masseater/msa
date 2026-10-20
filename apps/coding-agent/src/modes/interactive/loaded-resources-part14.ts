import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type promptTemplatesTypes from "../../core/prompt-templates.types.ts";
import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type skillsTypes from "../../core/skills.types.ts";
import loadedResourcesPart8 from "./loaded-resources-part8.ts";
import loadedResourcesPart13 from "./loaded-resources-part13.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";
import type themeTypes from "./theme/theme.types.ts";

const { buildSectionHeader } = loadedResourcesPart8;
const { buildAddDiagnosticsPart1 } = loadedResourcesPart13;

function buildAddDiagnostics(
  source: loadedResourcesTypes.LoadedResourcesSource,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  addDiagnostics: (
    title: string,
    diagnostics: readonly resourceLoaderTypes.ResourceDiagnostic[],
  ) => void;
  skillsResult: {
    skills: skillsTypes.Skill[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  };
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
  } = buildSectionHeader(source, options, container);
  const addDiagnostics = buildAddDiagnosticsPart1(
    container,
    sectionHeader,
    sourceInfos,
    options,
    resourceLoader,
    addSection,
    skillsResult,
    source,
    extensions,
  );
  return { addDiagnostics, extensionsResult, promptsResult, skillsResult, themesResult };
}

function buildPart4(
  options: loadedResourcesTypes.LoadedResourcesOptions,
  addDiagnostics: (
    title: string,
    diagnostics: readonly resourceLoaderTypes.ResourceDiagnostic[],
  ) => void,
  skillsResult: {
    skills: skillsTypes.Skill[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  },
  promptsResult: {
    prompts: promptTemplatesTypes.PromptTemplate[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  },
  extensionsResult: extensionsTypesTypes.LoadExtensionsResult,
  source: loadedResourcesTypes.LoadedResourcesSource,
  themesResult: {
    themes: themeTypes.Theme[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  },
): void {
  if (options.showDiagnostics) {
    addDiagnostics("Skill conflicts", skillsResult.diagnostics);
    addDiagnostics("Prompt conflicts", promptsResult.diagnostics);
    addDiagnostics("Extension issues", [
      ...extensionsResult.errors.map((error) => ({
        message: error.error,
        path: error.path,
        type: "error" as const,
      })),
      ...(extensionsResult.warnings ?? []).map((warning) => ({
        message: warning.warning,
        path: warning.path,
        type: "warning" as const,
      })),
      ...source.extensionRunnerDiagnostics,
    ]);
    addDiagnostics("Theme conflicts", themesResult.diagnostics);
  }
}

const loadedResourcesPart14 = {
  buildAddDiagnostics,
  buildPart4,
};

export default loadedResourcesPart14;
