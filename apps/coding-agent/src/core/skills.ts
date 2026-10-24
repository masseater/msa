import config from "../config.ts";
import html from "../utils/html.ts";
import paths from "../utils/paths.ts";
import awaitingModule from "./awaiting.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import platformModule from "./platform/index.ts";
import skillDirectory from "./skill-directory.ts";
import skillFile from "./skill-file.ts";
import type skillsTypes from "./skills.types.ts";

const { escapeXml } = html;
const { exists, stat } = platformModule.files;
const { awaited, promised } = awaitingModule;
const { canonicalizePath, isPathWithin, resolvePath } = paths;
const { join, resolve } = platformModule;
const { CONFIG_DIR_NAME, getAgentDir } = config;
const { loadSkillFromFile } = skillFile;
const { loadSkillsFromDirInternal } = skillDirectory;

function loadSkills(options: skillsTypes.LoadSkillsOptions): Promise<skillsTypes.LoadSkillsResult> {
  return promised(() => loadSkillsGen(options));
}

function* loadSkillsGen(options: skillsTypes.LoadSkillsOptions) {
  const { agentDir, skillPaths, includeDefaults } = options;

  const resolvedCwd = resolvePath(options.cwd);
  const resolvedAgentDir = resolvePath(agentDir ?? getAgentDir());

  const skillMap = new Map<string, skillsTypes.Skill>();
  const realPathSet = new Set<string>();
  const allDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
  const collisionDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  function addSkills(result: skillsTypes.LoadSkillsResult): Promise<void> {
    allDiagnostics.push(...result.diagnostics);
    return mergeLoadedSkills(result, realPathSet, skillMap, collisionDiagnostics);
  }

  const userSkillsDir = join(resolvedAgentDir, "skills");
  const projectSkillsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "skills");
  if (includeDefaults) {
    yield* awaited(loadSkillsFromDirInternal(userSkillsDir, "user", true).then(addSkills));
    yield* awaited(loadSkillsFromDirInternal(projectSkillsDir, "project", true).then(addSkills));
  }

  const getSource = (resolvedPath: string): "user" | "project" | "path" => {
    if (!includeDefaults) {
      if (isPathWithin(resolvedPath, userSkillsDir)) return "user";
      if (isPathWithin(resolvedPath, projectSkillsDir)) return "project";
    }
    return "path";
  };

  return yield* loadExplicitSkillPaths(
    skillPaths,
    resolvedCwd,
    allDiagnostics,
    getSource,
    addSkills,
    collisionDiagnostics,
    skillMap,
  );
}

function mergeLoadedSkills(
  result: skillsTypes.LoadSkillsResult,
  realPathSet: Set<string>,
  skillMap: Map<string, skillsTypes.Skill>,
  collisionDiagnostics: diagnosticsTypes.ResourceDiagnostic[],
): Promise<void> {
  return Promise.all(result.skills.map((skill) => canonicalizePath(skill.filePath))).then(
    (realPaths) => {
      for (const [index, skill] of result.skills.entries())
        mergeLoadedSkill({
          collisionDiagnostics,
          realPath: realPaths[index]!,
          realPathSet,
          skill,
          skillMap,
        });
      return undefined;
    },
  );
}

function mergeLoadedSkill(input: {
  readonly skill: skillsTypes.Skill;
  readonly realPath: string;
  readonly realPathSet: Set<string>;
  readonly skillMap: Map<string, skillsTypes.Skill>;
  readonly collisionDiagnostics: diagnosticsTypes.ResourceDiagnostic[];
}): void {
  const { collisionDiagnostics, realPath, realPathSet, skill, skillMap } = input;
  if (realPathSet.has(realPath)) {
    return;
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

function* loadExplicitSkillPaths(
  skillPaths: string[],
  resolvedCwd: string,
  allDiagnostics: diagnosticsTypes.ResourceDiagnostic[],
  getSource: (resolvedPath: string) => "user" | "project" | "path",
  addSkills: (result: skillsTypes.LoadSkillsResult) => Promise<void>,
  collisionDiagnostics: diagnosticsTypes.ResourceDiagnostic[],
  skillMap: Map<string, skillsTypes.Skill>,
) {
  for (const rawPath of skillPaths) {
    const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
    if (!(yield* awaited(exists(resolvedPath)))) {
      allDiagnostics.push({
        message: "skill path does not exist",
        path: resolvedPath,
        type: "warning",
      });
      continue;
    }

    try {
      const stats = yield* awaited(stat(resolvedPath));
      const source = getSource(resolvedPath);
      if (stats.isDirectory) {
        yield* awaited(loadSkillsFromDirInternal(resolvedPath, source, true).then(addSkills));
      } else if (stats.isFile && resolvedPath.endsWith(".md")) {
        const result = yield* awaited(loadSkillFromFile(resolvedPath, source));
        if (result.skill === null) {
          allDiagnostics.push(...result.diagnostics);
        } else {
          yield* awaited(addSkills({ diagnostics: result.diagnostics, skills: [result.skill] }));
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

const SKILLS_INTRO = "The following skills provide specialized instructions for specific tasks.";

const SKILL_READER_HINTS = {
  bash: "Use bash to load a skill's file when the task matches its description.",
  indirect: "Load a skill's file when the task matches its description.",
  read: "Use the read tool to load a skill's file when the task matches its description.",
} as const;

function formatSkillsForPrompt(
  skills: skillsTypes.Skill[],
  fileReadTool: "read" | "bash" | "indirect" = "read",
): string {
  const visibleSkills = skills.filter((s) => !s.disableModelInvocation);

  if (visibleSkills.length === 0) {
    return "";
  }

  const lines = [
    `\n\n${SKILLS_INTRO}`,
    SKILL_READER_HINTS[fileReadTool],
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];

  for (const skill of visibleSkills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");

  return lines.join("\n");
}

const skillsModule = { SKILLS_INTRO, SKILL_READER_HINTS, formatSkillsForPrompt, loadSkills };

export default skillsModule;
