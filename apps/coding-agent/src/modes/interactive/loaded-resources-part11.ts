import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type promptTemplatesTypes from "../../core/prompt-templates.types.ts";
import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type skillsTypes from "../../core/skills.types.ts";
import pathsModule from "../../utils/paths.ts";
import loadedResourcesPart1 from "./loaded-resources-part1.ts";
import loadedResourcesPart2 from "./loaded-resources-part2.ts";
import loadedResourcesPart10 from "./loaded-resources-part10.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";
import themeModule from "./theme/theme.ts";

const { Spacer } = tui;
const { theme } = themeModule;
const { abbreviateHomePath } = pathsModule;
const { formatCompactList } = loadedResourcesPart2;
const { formatContextPath } = loadedResourcesPart1;
const { buildTemplatesTemplatesTemplatesPart1 } = loadedResourcesPart10;

function buildTemplatesTemplatesTemplates(
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
  const systemPromptSource = resourceLoader.getSystemPromptSource();
  const contextFiles = [
    ...(systemPromptSource === undefined ? [] : [systemPromptSource]),
    ...resourceLoader.getAppendSystemPromptSources(),
    ...resourceLoader.getAgentsFiles().agentsFiles,
  ];
  if (contextFiles.length > 0) {
    container.addChild(new Spacer(1));
    addSection(
      "Context",
      () =>
        formatCompactList(
          contextFiles.map((file) => formatContextPath(file.path, options.cwd)),
          false,
        ),
      () =>
        contextFiles
          .map((file) => theme.fg("dim", `  ${abbreviateHomePath(file.path)}`))
          .join("\n"),
    );
  }

  buildTemplatesTemplatesTemplatesPart1(skillsResult, addSection);

  const templates = source.promptTemplates;
  return templates;
}

const loadedResourcesPart11 = {
  buildTemplatesTemplatesTemplates,
};

export default loadedResourcesPart11;
