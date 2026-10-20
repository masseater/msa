import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type skillsTypes from "../../core/skills.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";
import loadedResourcesPart9 from "./loaded-resources-part9.ts";
import loadedResourcesPart12 from "./loaded-resources-part12.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";
import type themeTypes from "./theme/theme.types.ts";

const { Spacer } = tui;
const { buildAddDiagnosticsPart1Part1 } = loadedResourcesPart9;
const { buildPart3, buildTemplates } = loadedResourcesPart12;

function buildAddDiagnosticsPart1(
  container: tuiTypes.Container,
  sectionHeader: (name: string, color: themeTypes.ThemeColor) => string,
  sourceInfos: Map<string, sourceInfoTypes.SourceInfo>,
  options: loadedResourcesTypes.LoadedResourcesOptions,
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
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
  skillsResult: {
    skills: skillsTypes.Skill[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  },
  source: loadedResourcesTypes.LoadedResourcesSource,
  extensions: readonly loadedResourcesTypes.ResourceItem[],
) {
  const addDiagnostics = (
    title: string,
    diagnostics: readonly resourceLoaderTypes.ResourceDiagnostic[],
  ) => {
    if (diagnostics.length === 0) return;
    buildAddDiagnosticsPart1Part1(container, sectionHeader, title, diagnostics, sourceInfos);
    container.addChild(new Spacer(1));
  };

  if (options.showListing) {
    const templates = buildTemplates(
      resourceLoader,
      container,
      addSection,
      options,
      skillsResult,
      source,
    );
    buildPart3(templates, addSection, extensions);
  }
  return addDiagnostics;
}

const loadedResourcesPart13 = {
  buildAddDiagnosticsPart1,
};

export default loadedResourcesPart13;
