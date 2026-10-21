import ignore from "ignore";

import type diagnosticsTypes from "./diagnostics.ts";
import directoryEntry from "./directory-entry.ts";
import ignoreRules from "./ignore-rules.ts";
import platformModule from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";
import skillFile from "./skill-file.ts";
import type skillsInternalTypes from "./skills-internal.types.ts";
import type skillsTypes from "./skills.types.ts";

const { relative } = platformModule;
const { readdirSync, existsSync } = nodeFs;
const { resolveEntry } = directoryEntry;
const { loadSkillFromFile } = skillFile;
const { toPosixPath, addIgnoreRules } = ignoreRules;

function loadSkillsFromDir(
  options: skillsTypes.LoadSkillsFromDirOptions,
): skillsTypes.LoadSkillsResult {
  const { dir, source } = options;
  return loadSkillsFromDirInternal(dir, source, true);
}

function rootSkillFile(
  dir: string,
  entries: readonly Parameters<typeof resolveEntry>[1][],
  root: string,
  ig: skillsInternalTypes.IgnoreMatcher,
): string | undefined {
  for (const entry of entries) {
    if (entry.name !== "SKILL.md") continue;
    const resolved = resolveEntry(dir, entry);
    if (resolved?.isFile === true && !ig.ignores(toPosixPath(relative(root, resolved.fullPath)))) {
      return resolved.fullPath;
    }
  }
  return undefined;
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
  if (!existsSync(dir)) return { diagnostics, skills };

  const root = rootDir ?? dir;
  const ig = ignoreMatcher ?? ignore();
  addIgnoreRules(ig, dir, root);
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const skillFilePath = rootSkillFile(dir, entries, root, ig);
    if (skillFilePath !== undefined) {
      collectSkillFile(skillFilePath, source, skills, diagnostics);
      return { diagnostics, skills };
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const resolved = resolveEntry(dir, entry);
      if (resolved === undefined) continue;
      const relPath = toPosixPath(relative(root, resolved.fullPath));
      if (ig.ignores(resolved.isDir ? `${relPath}/` : relPath)) continue;
      if (resolved.isDir) {
        const subResult = loadSkillsFromDirInternal(resolved.fullPath, source, false, ig, root);
        skills.push(...subResult.skills);
        diagnostics.push(...subResult.diagnostics);
      } else if (resolved.isFile && includeRootFiles && entry.name.endsWith(".md")) {
        collectSkillFile(resolved.fullPath, source, skills, diagnostics);
      }
    }
  } catch {}
  return { diagnostics, skills };
}

function collectSkillFile(
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

const skillDirectory = { loadSkillsFromDir, loadSkillsFromDirInternal };

export default skillDirectory;
