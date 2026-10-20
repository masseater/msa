import config from "../config.ts";
import paths from "../utils/paths.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import skillsPart1 from "./skills-part1.ts";
import skillsPart2 from "./skills-part2.ts";
import type skillsTypes from "./skills.types.ts";

const { canonicalizePath, resolvePath } = paths;
const { CONFIG_DIR_NAME, getAgentDir } = config;
const { join, resolve, sep } = platformNode;
const { existsSync, statSync } = nodeFs;
const { loadSkillsFromDirInternal } = skillsPart2;
const { loadSkillFromFile } = skillsPart1;

function loadSkills(options: skillsTypes.LoadSkillsOptions): skillsTypes.LoadSkillsResult {
  const { agentDir, skillPaths, includeDefaults } = options;

  const resolvedCwd = resolvePath(options.cwd);
  const resolvedAgentDir = resolvePath(agentDir ?? getAgentDir());

  const skillMap = new Map<string, skillsTypes.Skill>();
  const realPathSet = new Set<string>();
  const allDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
  const collisionDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  function addSkills(result: skillsTypes.LoadSkillsResult) {
    allDiagnostics.push(...result.diagnostics);
    loadSkillsPart2(result, realPathSet, skillMap, collisionDiagnostics);
  }

  if (includeDefaults) {
    addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, "skills"), "user", true));
    addSkills(
      loadSkillsFromDirInternal(resolve(resolvedCwd, CONFIG_DIR_NAME, "skills"), "project", true),
    );
  }

  const userSkillsDir = join(resolvedAgentDir, "skills");
  const projectSkillsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "skills");

  const isUnderPath = (target: string, root: string): boolean => {
    const normalizedRoot = resolve(root);
    if (target === normalizedRoot) {
      return true;
    }
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return target.startsWith(prefix);
  };

  const getSource = (resolvedPath: string): "user" | "project" | "path" => {
    if (!includeDefaults) {
      if (isUnderPath(resolvedPath, userSkillsDir)) return "user";
      if (isUnderPath(resolvedPath, projectSkillsDir)) return "project";
    }
    return "path";
  };

  return loadSkillsPart1(
    skillPaths,
    resolvedCwd,
    allDiagnostics,
    getSource,
    addSkills,
    collisionDiagnostics,
    skillMap,
  );
}

const skillsPart3 = {
  loadSkills,
};

export default skillsPart3;

function loadSkillsPart2(
  result: skillsTypes.LoadSkillsResult,
  realPathSet: Set<string>,
  skillMap: Map<string, skillsTypes.Skill>,
  collisionDiagnostics: diagnosticsTypes.ResourceDiagnostic[],
) {
  for (const skill of result.skills) {
    const realPath = canonicalizePath(skill.filePath);

    if (realPathSet.has(realPath)) {
      continue;
    }

    const existing = skillMap.get(skill.name);
    if (existing === undefined) {
      skillMap.set(skill.name, skill);
      realPathSet.add(realPath);
    } else {
      collisionDiagnostics.push({
        collision: {
          loserPath: skill.filePath,
          name: skill.name,
          resourceType: "skill",
          winnerPath: existing.filePath,
        },
        message: `name "${skill.name}" collision`,
        path: skill.filePath,
        type: "collision",
      });
    }
  }
}

function loadSkillsPart1(
  skillPaths: string[],
  resolvedCwd: string,
  allDiagnostics: diagnosticsTypes.ResourceDiagnostic[],
  getSource: (resolvedPath: string) => "user" | "project" | "path",
  addSkills: (result: skillsTypes.LoadSkillsResult) => void,
  collisionDiagnostics: diagnosticsTypes.ResourceDiagnostic[],
  skillMap: Map<string, skillsTypes.Skill>,
): skillsTypes.LoadSkillsResult {
  for (const rawPath of skillPaths) {
    const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
    if (!existsSync(resolvedPath)) {
      allDiagnostics.push({
        message: "skill path does not exist",
        path: resolvedPath,
        type: "warning",
      });
      continue;
    }

    try {
      const stats = statSync(resolvedPath);
      const source = getSource(resolvedPath);
      if (stats.isDirectory()) {
        addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
      } else if (stats.isFile() && resolvedPath.endsWith(".md")) {
        const result = loadSkillFromFile(resolvedPath, source);
        if (result.skill === null) {
          allDiagnostics.push(...result.diagnostics);
        } else {
          addSkills({ diagnostics: result.diagnostics, skills: [result.skill] });
        }
      } else {
        allDiagnostics.push({
          message: "skill path is not a markdown file",
          path: resolvedPath,
          type: "warning",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to read skill path";
      allDiagnostics.push({ message, path: resolvedPath, type: "warning" });
    }
  }

  return {
    diagnostics: [...allDiagnostics, ...collisionDiagnostics],
    skills: Array.from(skillMap.values()),
  };
}
