import ignore from "ignore";

import awaitingModule from "./awaiting.ts";
import directoryEntry from "./directory-entry.ts";
import ignoreRules from "./ignore-rules.ts";
import platformModule from "./platform/index.ts";
import skillFile from "./skill-file.ts";
import type skillsInternalTypes from "./skills-internal.types.ts";
import type skillsTypes from "./skills.types.ts";

const { relative } = platformModule;
const { exists } = platformModule.files;
const { readEntries, resolveEntry } = directoryEntry;
const { loadSkillFromFile } = skillFile;
const { toPosixPath, addIgnoreRules } = ignoreRules;
const { awaited, promised } = awaitingModule;

type Entry = Awaited<ReturnType<typeof readEntries>>[number];

function loadSkillsFromDir(
  options: skillsTypes.LoadSkillsFromDirOptions,
): Promise<skillsTypes.LoadSkillsResult> {
  const { dir, source } = options;
  return loadSkillsFromDirInternal(dir, source, true);
}

function* rootSkillFile(
  dir: string,
  entries: readonly Entry[],
  root: string,
  ig: skillsInternalTypes.IgnoreMatcher,
) {
  for (const entry of entries) {
    if (entry.name !== "SKILL.md") continue;
    const resolved = yield* awaited(resolveEntry(dir, entry));
    if (resolved?.isFile === true && !ig.ignores(toPosixPath(relative(root, resolved.fullPath)))) {
      return resolved.fullPath;
    }
  }
  return undefined;
}

function* collectEntries(input: {
  readonly dir: string;
  readonly entries: readonly Entry[];
  readonly source: string;
  readonly includeRootFiles: boolean;
  readonly ig: skillsInternalTypes.IgnoreMatcher;
  readonly root: string;
  readonly result: skillsTypes.LoadSkillsResult;
}) {
  const { dir, entries, ig, includeRootFiles, result, root, source } = input;
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const resolved = yield* awaited(resolveEntry(dir, entry));
    if (resolved === undefined) continue;
    const relPath = toPosixPath(relative(root, resolved.fullPath));
    if (ig.ignores(resolved.isDir ? `${relPath}/` : relPath)) continue;
    if (resolved.isDir) {
      const subResult = yield* awaited(
        loadSkillsFromDirInternal(resolved.fullPath, source, false, ig, root),
      );
      result.skills.push(...subResult.skills);
      result.diagnostics.push(...subResult.diagnostics);
    } else if (resolved.isFile && includeRootFiles && entry.name.endsWith(".md")) {
      yield* awaited(collectSkillFile(resolved.fullPath, source, result));
    }
  }
}

function loadSkillsFromDirInternal(
  dir: string,
  source: string,
  includeRootFiles: boolean,
  ignoreMatcher?: skillsInternalTypes.IgnoreMatcher,
  rootDir?: string,
): Promise<skillsTypes.LoadSkillsResult> {
  return promised(function* () {
    const result: skillsTypes.LoadSkillsResult = { diagnostics: [], skills: [] };
    if (!(yield* awaited(exists(dir)))) return result;
    const root = rootDir ?? dir;
    const ig = ignoreMatcher ?? ignore();
    yield* awaited(addIgnoreRules(ig, dir, root));
    try {
      const entries = yield* awaited(readEntries(dir));
      const skillFilePath = yield* rootSkillFile(dir, entries, root, ig);
      if (skillFilePath !== undefined) {
        yield* awaited(collectSkillFile(skillFilePath, source, result));
        return result;
      }
      yield* collectEntries({ dir, entries, ig, includeRootFiles, result, root, source });
    } catch {}
    return result;
  });
}

function collectSkillFile(
  fullPath: string,
  source: string,
  result: skillsTypes.LoadSkillsResult,
): Promise<void> {
  return loadSkillFromFile(fullPath, source).then((loaded) => {
    if (loaded.skill !== null) result.skills.push(loaded.skill);
    result.diagnostics.push(...loaded.diagnostics);
    return undefined;
  });
}

const skillDirectory = { loadSkillsFromDir, loadSkillsFromDirInternal };

export default skillDirectory;
