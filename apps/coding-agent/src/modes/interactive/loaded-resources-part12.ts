import type tuiTypes from "@msa/tui/index.types";

import type promptTemplatesTypes from "../../core/prompt-templates.types.ts";
import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type skillsTypes from "../../core/skills.types.ts";
import pathsModule from "../../utils/paths.ts";
import loadedResourcesPart1 from "./loaded-resources-part1.ts";
import loadedResourcesPart2 from "./loaded-resources-part2.ts";
import loadedResourcesPart11 from "./loaded-resources-part11.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";

const { abbreviateHomePath } = pathsModule;
const { buildTemplatesTemplatesTemplates } = loadedResourcesPart11;
const {
  buildScopeGroups,
  formatExtensionDisplayPath,
  formatScopeGroups,
  getCompactExtensionLabels,
  getShortPath,
} = loadedResourcesPart1;
const { formatCompactList } = loadedResourcesPart2;

function buildTemplates(
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
  container: tuiTypes.Container,
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  skillsResult: {
    skills: skillsTypes.Skill[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  },
  source: loadedResourcesTypes.LoadedResourcesSource,
): readonly promptTemplatesTypes.PromptTemplate[] {
  const templates = buildTemplatesTemplates(
    resourceLoader,
    container,
    addSection,
    options,
    skillsResult,
    source,
  );
  return templates;
}

function buildTemplatesTemplates(
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
  container: tuiTypes.Container,
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  skillsResult: {
    skills: skillsTypes.Skill[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  },
  source: loadedResourcesTypes.LoadedResourcesSource,
): readonly promptTemplatesTypes.PromptTemplate[] {
  const templates = buildTemplatesTemplatesTemplates(
    resourceLoader,
    container,
    addSection,
    options,
    skillsResult,
    source,
  );
  return templates;
}

function buildPart3(
  templates: readonly promptTemplatesTypes.PromptTemplate[],
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
  extensions: readonly loadedResourcesTypes.ResourceItem[],
): void {
  if (templates.length > 0) {
    const groups = buildScopeGroups(
      templates.map((template) => ({
        path: template.filePath,
        sourceInfo: template.sourceInfo,
      })),
    );
    const templateByPath = new Map(templates.map((template) => [template.filePath, template]));
    const formatTemplate = (item: loadedResourcesTypes.ResourceItem) => {
      const template = templateByPath.get(item.path);
      return template === undefined ? abbreviateHomePath(item.path) : `/${template.name}`;
    };
    addSection(
      "Prompts",
      () => formatCompactList(templates.map((template) => `/${template.name}`)),
      () => formatScopeGroups(groups, formatTemplate, formatTemplate),
    );
  }

  if (extensions.length > 0) {
    const groups = buildScopeGroups(extensions);
    const labels = getCompactExtensionLabels(extensions);
    addSection(
      "Extensions",
      () => formatCompactList(labels),
      () =>
        formatScopeGroups(
          groups,
          (item) => formatExtensionDisplayPath(item.path),
          (item) => formatExtensionDisplayPath(getShortPath(item.path, item.sourceInfo)),
        ),
    );
  }
}

const loadedResourcesPart12 = {
  buildPart3,
  buildTemplates,
};

export default loadedResourcesPart12;
