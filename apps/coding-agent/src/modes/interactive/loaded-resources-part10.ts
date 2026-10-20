import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type skillsTypes from "../../core/skills.types.ts";
import pathsModule from "../../utils/paths.ts";
import loadedResourcesPart1 from "./loaded-resources-part1.ts";
import loadedResourcesPart2 from "./loaded-resources-part2.ts";

const { abbreviateHomePath } = pathsModule;
const { buildScopeGroups, formatScopeGroups, getShortPath } = loadedResourcesPart1;
const { formatCompactList } = loadedResourcesPart2;

function buildTemplatesTemplatesTemplatesPart1(
  skillsResult: {
    skills: skillsTypes.Skill[];
    diagnostics: resourceLoaderTypes.ResourceDiagnostic[];
  },
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
) {
  const skills = skillsResult.skills;
  if (skills.length > 0) {
    const groups = buildScopeGroups(
      skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })),
    );
    addSection(
      "Skills",
      () => formatCompactList(skills.map((skill) => skill.name)),
      () =>
        formatScopeGroups(
          groups,
          (item) => abbreviateHomePath(item.path),
          (item) => getShortPath(item.path, item.sourceInfo),
        ),
    );
  }
}

const loadedResourcesPart10 = {
  buildTemplatesTemplatesTemplatesPart1,
};

export default loadedResourcesPart10;
