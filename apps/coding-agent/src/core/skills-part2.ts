import ignore from "ignore";

import type diagnosticsTypes from "./diagnostics.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import type skillsInternalTypes from "./skills-internal.types.ts";
import skillsPart1 from "./skills-part1.ts";
import type skillsTypes from "./skills.types.ts";

const { existsSync, readdirSync, statSync } = nodeFs;
const { join, relative } = platformNode;
const { addIgnoreRules, loadSkillFromFile, toPosixPath } = skillsPart1;

function loadSkillsFromDir(
  options: skillsTypes.LoadSkillsFromDirOptions,
): skillsTypes.LoadSkillsResult {
  const { dir, source } = options;
  return loadSkillsFromDirInternal(dir, source, true);
}

function loadSkillsFromDirInternal(
  dir: string,
  source: string,
  includeRootFiles: boolean,
  ignoreMatcher?: skillsInternalTypes.IgnoreMatcher,
  rootDir?: string,
): skillsTypes.LoadSkillsResult {
  const skills: skillsTypes.Skill[] = [];
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  if (!existsSync(dir)) {
    return { diagnostics, skills };
  }

  const root = rootDir ?? dir;
  const ig = ignoreMatcher ?? ignore();
  addIgnoreRules(ig, dir, root);

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name !== "SKILL.md") {
        continue;
      }

      const fullPath = join(dir, entry.name);

      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(root, fullPath));
      if (!isFile || ig.ignores(relPath)) {
        continue;
      }

      return loadSkillsFromDirInternalPart1(fullPath, source, skills, diagnostics);
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      if (entry.name === "node_modules") {
        continue;
      }

      const fullPath = join(dir, entry.name);

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath);
          isDirectory = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(root, fullPath));
      const ignorePath = isDirectory ? `${relPath}/` : relPath;
      if (ig.ignores(ignorePath)) {
        continue;
      }

      if (isDirectory) {
        const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root);
        skills.push(...subResult.skills);
        diagnostics.push(...subResult.diagnostics);
        continue;
      }

      if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) {
        continue;
      }

      loadSkillsFromDirInternalPart2(fullPath, source, skills, diagnostics);
    }
  } catch {}

  return { diagnostics, skills };
}

function loadSkillsFromDirInternalPart2(
  fullPath: string,
  source: string,
  skills: skillsTypes.Skill[],
  diagnostics: diagnosticsTypes.ResourceDiagnostic[],
) {
  const result = loadSkillFromFile(fullPath, source);
  if (result.skill !== null) {
    skills.push(result.skill);
  }
  diagnostics.push(...result.diagnostics);
}

function loadSkillsFromDirInternalPart1(
  fullPath: string,
  source: string,
  skills: skillsTypes.Skill[],
  diagnostics: diagnosticsTypes.ResourceDiagnostic[],
): skillsTypes.LoadSkillsResult {
  const result = loadSkillFromFile(fullPath, source);
  if (result.skill !== null) {
    skills.push(result.skill);
  }
  diagnostics.push(...result.diagnostics);
  return { diagnostics, skills };
}

function formatSkillsForPrompt(
  skills: skillsTypes.Skill[],
  fileReadTool: "read" | "bash" | "indirect" = "read",
): string {
  const visibleSkills = skills.filter((s) => !s.disableModelInvocation);

  if (visibleSkills.length === 0) {
    return "";
  }

  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    fileReadTool === "read"
      ? "Use the read tool to load a skill's file when the task matches its description."
      : fileReadTool === "bash"
        ? "Use bash to load a skill's file when the task matches its description."
        : "Load a skill's file when the task matches its description.",
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

function escapeXml(str: string): string {
  return str
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

const skillsPart2 = {
  formatSkillsForPrompt,
  loadSkillsFromDir,
  loadSkillsFromDirInternal,
};

export default skillsPart2;
