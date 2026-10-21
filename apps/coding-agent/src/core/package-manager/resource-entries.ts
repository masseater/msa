import ignore from "ignore";

import awaitingModule from "../awaiting.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import directoryEntry from "../directory-entry.ts";
import ignoreRules from "../ignore-rules.ts";
import manifestModule from "../manifest.ts";
import platformModule from "../platform/index.ts";
import resourceFiles from "./resource-files.ts";

const { readMsaManifest } = manifestModule;
const { dirname, join, relative, resolve } = platformModule;
const { exists } = platformModule.files;
const { FILE_PATTERNS, collectFiles } = resourceFiles;
const { toPosixPath, addIgnoreRules } = ignoreRules;
const { awaited, promised } = awaitingModule;

const { readEntries, resolveEntry } = directoryEntry;

type Entry = Awaited<ReturnType<typeof readEntries>>[number];

const isHiddenOrModules = (entry: Entry): boolean =>
  entry.name.startsWith(".") || entry.name === "node_modules";

function* rootSkillFile(
  dir: string,
  dirEntries: readonly Entry[],
  root: string,
  ig: defaultPackageManagerInternalTypes.IgnoreMatcher,
) {
  for (const entry of dirEntries) {
    if (entry.name !== "SKILL.md") continue;
    const resolved = yield* awaited(resolveEntry(dir, entry));
    if (resolved === undefined) continue;
    if (resolved.isFile && !ig.ignores(toPosixPath(relative(root, resolved.fullPath)))) {
      return resolved.fullPath;
    }
  }
  return undefined;
}

function collectSkillEntries(
  dir: string,
  mode: defaultPackageManagerInternalTypes.SkillDiscoveryMode,
  ignoreMatcher?: defaultPackageManagerInternalTypes.IgnoreMatcher,
  rootDir?: string,
): Promise<string[]> {
  return promised(function* () {
    const entries: string[] = [];
    if (!(yield* awaited(exists(dir)))) return entries;

    const root = rootDir ?? dir;
    const ig = ignoreMatcher ?? ignore();
    yield* awaited(addIgnoreRules(ig, dir, root));

    try {
      const dirEntries = yield* awaited(readEntries(dir));
      const skillFile = yield* rootSkillFile(dir, dirEntries, root, ig);
      if (skillFile !== undefined) return [skillFile];

      for (const entry of dirEntries) {
        if (isHiddenOrModules(entry)) continue;
        const resolved = yield* awaited(resolveEntry(dir, entry));
        if (resolved === undefined) continue;
        const { fullPath, isDir, isFile } = resolved;
        const relPath = toPosixPath(relative(root, fullPath));
        const shouldIncludeMarkdownFile =
          isFile &&
          entry.name.endsWith(".md") &&
          !ig.ignores(relPath) &&
          ((mode === "msa" && dir === root) || (mode === "agents" && dir !== root));
        if (shouldIncludeMarkdownFile) {
          entries.push(fullPath);
        } else if (isDir && !ig.ignores(`${relPath}/`)) {
          entries.push(...(yield* awaited(collectSkillEntries(fullPath, mode, ig, root))));
        }
      }
    } catch {}

    return entries;
  });
}

function collectAutoSkillEntries(
  dir: string,
  mode: defaultPackageManagerInternalTypes.SkillDiscoveryMode,
): Promise<string[]> {
  return collectSkillEntries(dir, mode);
}

function findGitRepoRoot(startDir: string): Promise<string | null> {
  const dir = resolve(startDir);
  return exists(join(dir, ".git")).then((found) => {
    if (found) return dir;
    const parent = dirname(dir);
    return parent === dir ? null : findGitRepoRoot(parent);
  });
}

function collectAncestorAgentsSkillDirs(startDir: string): Promise<string[]> {
  const resolvedStartDir = resolve(startDir);
  return findGitRepoRoot(resolvedStartDir).then((gitRepoRoot) => {
    const skillDirs: string[] = [];
    let dir = resolvedStartDir;
    while (true) {
      skillDirs.push(join(dir, ".agents", "skills"));
      if (gitRepoRoot !== null && gitRepoRoot !== "" && dir === gitRepoRoot) {
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    return skillDirs;
  });
}

function collectAutoFileEntries(dir: string, extension: string): Promise<string[]> {
  return promised(function* () {
    const entries: string[] = [];
    if (!(yield* awaited(exists(dir)))) return entries;

    const ig = ignore();
    yield* awaited(addIgnoreRules(ig, dir, dir));

    try {
      for (const entry of yield* awaited(readEntries(dir))) {
        if (isHiddenOrModules(entry)) continue;
        const resolved = yield* awaited(resolveEntry(dir, entry));
        if (resolved === undefined) continue;
        if (ig.ignores(toPosixPath(relative(dir, resolved.fullPath)))) continue;
        if (resolved.isFile && entry.name.endsWith(extension)) entries.push(resolved.fullPath);
      }
    } catch {}

    return entries;
  });
}

function collectAutoPromptEntries(dir: string): Promise<string[]> {
  return collectAutoFileEntries(dir, ".md");
}

function collectAutoThemeEntries(dir: string): Promise<string[]> {
  return collectAutoFileEntries(dir, ".json");
}

function* manifestExtensionEntries(dir: string) {
  const packageJsonPath = join(dir, "package.json");
  if (!(yield* awaited(exists(packageJsonPath)))) return [];
  const manifest = yield* awaited(readMsaManifest(packageJsonPath));
  const entries: string[] = [];
  for (const extPath of manifest?.extensions ?? []) {
    const resolvedExtPath = resolve(dir, extPath);
    if (yield* awaited(exists(resolvedExtPath))) entries.push(resolvedExtPath);
  }
  return entries;
}

function resolveExtensionEntries(dir: string): Promise<string[] | null> {
  return promised(function* () {
    const manifestEntries = yield* manifestExtensionEntries(dir);
    if (manifestEntries.length > 0) return manifestEntries;

    const indexTs = join(dir, "index.ts");
    const indexJs = join(dir, "index.js");
    if (yield* awaited(exists(indexTs))) {
      return [indexTs];
    }
    if (yield* awaited(exists(indexJs))) {
      return [indexJs];
    }

    return null;
  });
}

function collectAutoExtensionEntries(dir: string): Promise<string[]> {
  return promised(function* () {
    const entries: string[] = [];
    if (!(yield* awaited(exists(dir)))) return entries;

    const rootEntries = yield* awaited(resolveExtensionEntries(dir));
    if (rootEntries !== null) {
      return rootEntries;
    }

    const ig = ignore();
    yield* awaited(addIgnoreRules(ig, dir, dir));

    try {
      for (const entry of yield* awaited(readEntries(dir))) {
        if (isHiddenOrModules(entry)) continue;
        const resolved = yield* awaited(resolveEntry(dir, entry));
        if (resolved === undefined) continue;
        const { fullPath, isDir, isFile } = resolved;
        const relPath = toPosixPath(relative(dir, fullPath));
        if (ig.ignores(isDir ? `${relPath}/` : relPath)) continue;

        if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          entries.push(fullPath);
        } else if (isDir) {
          entries.push(...((yield* awaited(resolveExtensionEntries(fullPath))) ?? []));
        }
      }
    } catch {}

    return entries;
  });
}

function collectResourceFiles(
  dir: string,
  resourceType: defaultPackageManagerInternalTypes.ResourceType,
): Promise<string[]> {
  if (resourceType === "skills") {
    return collectSkillEntries(dir, "msa");
  }
  if (resourceType === "extensions") {
    return collectAutoExtensionEntries(dir);
  }
  return collectFiles(dir, FILE_PATTERNS[resourceType]);
}

const resourceEntries = {
  collectAncestorAgentsSkillDirs,
  collectAutoExtensionEntries,
  collectAutoPromptEntries,
  collectAutoSkillEntries,
  collectAutoThemeEntries,
  collectResourceFiles,
};

export default resourceEntries;
