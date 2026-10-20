import ignore from "ignore";
import { minimatch } from "minimatch";

import pathsModule from "../utils/paths.ts";
import defaultPackageManagerHelpersPart1 from "./default-package-manager-helpers-part1.ts";
import defaultPackageManagerHelpersPart2 from "./default-package-manager-helpers-part2.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";

const { existsSync, readdirSync, statSync } = nodeFs;
const { basename, dirname, join, relative } = platformNode;
const { normalizePath } = pathsModule;
const { collectSkillEntries, resolveExtensionEntries } = defaultPackageManagerHelpersPart2;
const { FILE_PATTERNS, addIgnoreRules, collectFiles, toPosixPath } =
  defaultPackageManagerHelpersPart1;

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

function collectResourceFiles(
  dir: string,
  resourceType: defaultPackageManagerInternalTypes.ResourceType,
): string[] {
  if (resourceType === "skills") {
    return collectSkillEntries(dir, "msa");
  }
  if (resourceType === "extensions") {
    return collectAutoExtensionEntries(dir);
  }
  return collectFiles(dir, FILE_PATTERNS[resourceType]);
}

function matchesAnyPattern(filePath: string, patterns: string[], baseDir: string): boolean {
  const rel = toPosixPath(relative(baseDir, filePath));
  const name = basename(filePath);
  const filePathPosix = toPosixPath(filePath);
  const isSkillFile = name === "SKILL.md";
  const parentDir = isSkillFile ? dirname(filePath) : undefined;
  const parentRel = isSkillFile ? toPosixPath(relative(baseDir, parentDir!)) : undefined;
  const parentName = isSkillFile ? basename(parentDir!) : undefined;
  const parentDirPosix = isSkillFile ? toPosixPath(parentDir!) : undefined;

  return patterns.some((pattern) => {
    const normalizedPattern = toPosixPath(normalizePath(pattern));
    if (
      minimatch(rel, normalizedPattern) ||
      minimatch(name, normalizedPattern) ||
      minimatch(filePathPosix, normalizedPattern)
    ) {
      return true;
    }
    if (!isSkillFile) return false;
    return (
      minimatch(parentRel!, normalizedPattern) ||
      minimatch(parentName!, normalizedPattern) ||
      minimatch(parentDirPosix!, normalizedPattern)
    );
  });
}

function normalizeExactPattern(pattern: string): string {
  const normalized =
    pattern.startsWith("./") || pattern.startsWith(".\\") ? pattern.slice(2) : pattern;
  return toPosixPath(normalizePath(normalized));
}

function matchesAnyExactPattern(filePath: string, patterns: string[], baseDir: string): boolean {
  if (patterns.length === 0) return false;
  const rel = toPosixPath(relative(baseDir, filePath));
  const name = basename(filePath);
  const filePathPosix = toPosixPath(filePath);
  const isSkillFile = name === "SKILL.md";
  const parentDir = isSkillFile ? dirname(filePath) : undefined;
  const parentRel = isSkillFile ? toPosixPath(relative(baseDir, parentDir!)) : undefined;
  const parentDirPosix = isSkillFile ? toPosixPath(parentDir!) : undefined;

  return patterns.some((pattern) => {
    const normalized = normalizeExactPattern(pattern);
    if (normalized === rel || normalized === filePathPosix) {
      return true;
    }
    if (!isSkillFile) return false;
    return normalized === parentRel || normalized === parentDirPosix;
  });
}

function getOverridePatterns(entries: string[]): string[] {
  return entries.filter(
    (pattern) => pattern.startsWith("!") || pattern.startsWith("+") || pattern.startsWith("-"),
  );
}

function isEnabledByOverrides(filePath: string, patterns: string[], baseDir: string): boolean {
  const overrides = getOverridePatterns(patterns);
  const excludes = overrides
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  const forceIncludes = overrides
    .filter((pattern) => pattern.startsWith("+"))
    .map((pattern) => pattern.slice(1));
  const forceExcludes = overrides
    .filter((pattern) => pattern.startsWith("-"))
    .map((pattern) => pattern.slice(1));

  let enabled = true;
  if (excludes.length > 0 && matchesAnyPattern(filePath, excludes, baseDir)) {
    enabled = false;
  }
  if (forceIncludes.length > 0 && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) {
    enabled = true;
  }
  if (forceExcludes.length > 0 && matchesAnyExactPattern(filePath, forceExcludes, baseDir)) {
    enabled = false;
  }
  return enabled;
}

function applyPatterns(allPaths: string[], patterns: string[], baseDir: string): Set<string> {
  const includes: string[] = [];
  const excludes: string[] = [];
  const forceIncludes: string[] = [];
  const forceExcludes: string[] = [];

  for (const p of patterns) {
    if (p.startsWith("+")) {
      forceIncludes.push(p.slice(1));
    } else if (p.startsWith("-")) {
      forceExcludes.push(p.slice(1));
    } else if (p.startsWith("!")) {
      excludes.push(p.slice(1));
    } else {
      includes.push(p);
    }
  }

  let result: string[];
  if (includes.length === 0) {
    result = [...allPaths];
  } else {
    result = allPaths.filter((filePath) => matchesAnyPattern(filePath, includes, baseDir));
  }

  if (excludes.length > 0) {
    result = result.filter((filePath) => !matchesAnyPattern(filePath, excludes, baseDir));
  }

  if (forceIncludes.length > 0) {
    for (const filePath of allPaths) {
      if (!result.includes(filePath) && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) {
        result.push(filePath);
      }
    }
  }

  if (forceExcludes.length > 0) {
    result = result.filter((filePath) => !matchesAnyExactPattern(filePath, forceExcludes, baseDir));
  }

  return new Set(result);
}

function applyAutoloadDisabledPatterns(
  allPaths: string[],
  patterns: string[],
  baseDir: string,
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const pattern of patterns) {
    const target = pattern.slice(
      pattern.startsWith("+") || pattern.startsWith("-") || pattern.startsWith("!") ? 1 : 0,
    );
    const enabled = !pattern.startsWith("-") && !pattern.startsWith("!");
    const exact = pattern.startsWith("+") || pattern.startsWith("-");
    for (const filePath of allPaths) {
      if (
        exact
          ? matchesAnyExactPattern(filePath, [target], baseDir)
          : matchesAnyPattern(filePath, [target], baseDir)
      ) {
        result.set(filePath, enabled);
      }
    }
  }
  return result;
}

const defaultPackageManagerHelpersPart3 = {
  applyAutoloadDisabledPatterns,
  applyPatterns,
  collectAutoExtensionEntries,
  collectResourceFiles,
  getOverridePatterns,
  isEnabledByOverrides,
  matchesAnyExactPattern,
  matchesAnyPattern,
  normalizeExactPattern,
};

export default defaultPackageManagerHelpersPart3;
