import ignore from "ignore";

import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import manifestModule from "../manifest.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";
import resourceFiles from "./resource-files.ts";

const { readMsaManifest } = manifestModule;
const { dirname, resolve, relative, join } = platformNode;
const { statSync, readdirSync, existsSync } = nodeFs;
const { toPosixPath, addIgnoreRules } = resourceFiles;

type ResolvedEntry = { fullPath: string; isDir: boolean; isFile: boolean };

function resolveEntry(
  dir: string,
  entry: { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean },
): ResolvedEntry | undefined {
  const fullPath = join(dir, entry.name);
  if (!entry.isSymbolicLink()) {
    return { fullPath, isDir: entry.isDirectory(), isFile: entry.isFile() };
  }
  try {
    const stats = statSync(fullPath);
    return { fullPath, isDir: stats.isDirectory(), isFile: stats.isFile() };
  } catch {
    return undefined;
  }
}

function collectSkillEntries(
  dir: string,
  mode: defaultPackageManagerInternalTypes.SkillDiscoveryMode,
  ignoreMatcher?: defaultPackageManagerInternalTypes.IgnoreMatcher,
  rootDir?: string,
): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  const root = rootDir ?? dir;
  const ig = ignoreMatcher ?? ignore();
  addIgnoreRules(ig, dir, root);

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name !== "SKILL.md") continue;
      const resolved = resolveEntry(dir, entry);
      if (resolved === undefined) continue;
      if (resolved.isFile && !ig.ignores(toPosixPath(relative(root, resolved.fullPath)))) {
        entries.push(resolved.fullPath);
        return entries;
      }
    }

    for (const entry of dirEntries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const resolved = resolveEntry(dir, entry);
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
        entries.push(...collectSkillEntries(fullPath, mode, ig, root));
      }
    }
  } catch {}

  return entries;
}

function collectAutoSkillEntries(
  dir: string,
  mode: defaultPackageManagerInternalTypes.SkillDiscoveryMode,
): string[] {
  return collectSkillEntries(dir, mode);
}

function findGitRepoRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function collectAncestorAgentsSkillDirs(startDir: string): string[] {
  const skillDirs: string[] = [];
  const resolvedStartDir = resolve(startDir);
  const gitRepoRoot = findGitRepoRoot(resolvedStartDir);

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
}

function collectAutoPromptEntries(dir: string): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  const ig = ignore();
  addIgnoreRules(ig, dir, dir);

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(dir, fullPath));
      if (ig.ignores(relPath)) continue;

      if (isFile && entry.name.endsWith(".md")) {
        entries.push(fullPath);
      }
    }
  } catch {}

  return entries;
}

function collectAutoThemeEntries(dir: string): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  const ig = ignore();
  addIgnoreRules(ig, dir, dir);

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(fullPath).isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(dir, fullPath));
      if (ig.ignores(relPath)) continue;

      if (isFile && entry.name.endsWith(".json")) {
        entries.push(fullPath);
      }
    }
  } catch {}

  return entries;
}

function resolveExtensionEntries(dir: string): string[] | null {
  const packageJsonPath = join(dir, "package.json");
  if (existsSync(packageJsonPath)) {
    const manifest = readMsaManifest(packageJsonPath);
    if (manifest?.extensions?.length !== undefined && manifest?.extensions?.length !== 0) {
      const entries: string[] = [];
      for (const extPath of manifest.extensions) {
        const resolvedExtPath = resolve(dir, extPath);
        if (existsSync(resolvedExtPath)) {
          entries.push(resolvedExtPath);
        }
      }
      if (entries.length > 0) {
        return entries;
      }
    }
  }

  const indexTs = join(dir, "index.ts");
  const indexJs = join(dir, "index.js");
  if (existsSync(indexTs)) {
    return [indexTs];
  }
  if (existsSync(indexJs)) {
    return [indexJs];
  }

  return null;
}

function collectAutoExtensionEntries(dir: string): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  const rootEntries = resolveExtensionEntries(dir);
  if (rootEntries !== null) {
    return rootEntries;
  }

  const ig = ignore();
  addIgnoreRules(ig, dir, dir);

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath);
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(dir, fullPath));
      const ignorePath = isDir ? `${relPath}/` : relPath;
      if (ig.ignores(ignorePath)) continue;

      if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        entries.push(fullPath);
      } else if (isDir) {
        const resolvedEntries = resolveExtensionEntries(fullPath);
        if (resolvedEntries !== null) {
          entries.push(...resolvedEntries);
        }
      }
    }
  } catch {}

  return entries;
}

const resourceEntries = {
  collectAncestorAgentsSkillDirs,
  collectAutoExtensionEntries,
  collectAutoPromptEntries,
  collectAutoSkillEntries,
  collectAutoThemeEntries,
  collectSkillEntries,
};

export default resourceEntries;
