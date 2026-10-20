import { dual } from "effect/Function";

import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";
import git from "../../utils/git.ts";
import pathsModule from "../../utils/paths.ts";
import pathModule from "../path.ts";
import type loadedResourcesInternalTypes from "./loaded-resources-internal.types.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";
import themeModule from "./theme/theme.ts";

const { abbreviateHomePath, getCwdRelativePath } = pathsModule;
const { isAbsolute, posixParse, posixRelative, relative, resolve } = pathModule;
const { parseGitUrl } = git;
const { theme } = themeModule;

const getStartupVisibility: {
  (verbose: boolean): (quietStartup: settingsManagerTypes.QuietStartup | undefined) => {
    header: boolean;
    details: boolean;
  };
  (
    quietStartup: settingsManagerTypes.QuietStartup | undefined,
    verbose: boolean,
  ): { header: boolean; details: boolean };
} = dual(
  2,
  (
    quietStartup: settingsManagerTypes.QuietStartup | undefined,
    verbose: boolean,
  ): { header: boolean; details: boolean } => ({
    details: verbose || quietStartup === false,
    header: verbose || quietStartup !== true,
  }),
);

const toPosix = (p: string): string => p.replace(/\\/gu, "/");

function isPackageSource(sourceInfo?: sourceInfoTypes.SourceInfo): boolean {
  const source = sourceInfo?.source ?? "";
  return source.startsWith("npm:") || source.startsWith("git:");
}

function formatExtensionDisplayPath(p: string): string {
  return abbreviateHomePath(p)
    .replace(/\/index\.ts$/u, "")
    .replace(/\/index\.js$/u, "");
}

function formatContextPath(p: string, cwd: string): string {
  const resolvedCwd = resolve(cwd);
  const absolutePath = isAbsolute(p) ? resolve(p) : resolve(resolvedCwd, p);
  return getCwdRelativePath(absolutePath, resolvedCwd) ?? abbreviateHomePath(absolutePath);
}

function getShortPath(fullPath: string, sourceInfo?: sourceInfoTypes.SourceInfo): string {
  const normalizedFullPath = toPosix(fullPath);
  const baseDir = sourceInfo?.baseDir;
  if (baseDir !== undefined && baseDir !== "" && isPackageSource(sourceInfo)) {
    const normalizedBaseDir = toPosix(baseDir);
    const npmRootMatch = normalizedBaseDir.match(/^(.*\/node_modules)\/(@?[^/]+(?:\/[^/]+)?)$/u);
    if (
      npmRootMatch?.[1] !== undefined &&
      npmRootMatch?.[1] !== "" &&
      normalizedFullPath.startsWith(`${npmRootMatch[1]}/`)
    ) {
      return posixRelative(normalizedBaseDir, normalizedFullPath);
    }

    const relativePath = relative(resolve(baseDir), resolve(fullPath));
    if (
      relativePath !== "" &&
      relativePath !== "." &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath)
    ) {
      return toPosix(relativePath);
    }
  }

  const source = sourceInfo?.source ?? "";
  const npmMatch = normalizedFullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/u);
  if (npmMatch !== null && source.startsWith("npm:")) {
    return npmMatch[2]!;
  }

  const gitMatch = normalizedFullPath.match(/git\/[^/]+\/[^/]+\/(.*)/u);
  if (gitMatch !== null && source.startsWith("git:")) {
    return gitMatch[1]!;
  }

  return abbreviateHomePath(fullPath);
}

function pathSegments(p: string): string[] {
  return toPosix(p)
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "~");
}

function getCompactPathLabel(
  resourcePath: string,
  sourceInfo?: sourceInfoTypes.SourceInfo,
): string {
  const shortPath = getShortPath(resourcePath, sourceInfo);
  return pathSegments(shortPath).at(-1) ?? shortPath;
}

function getCompactPackageSourceLabel(sourceInfo?: sourceInfoTypes.SourceInfo): string {
  const source = sourceInfo?.source ?? "";
  if (source.startsWith("npm:")) {
    return source.slice("npm:".length) || source;
  }
  return parseGitUrl(source)?.path || source;
}

function getCompactPackageExtensionLabel(
  resourcePath: string,
  sourceInfo?: sourceInfoTypes.SourceInfo,
): string {
  const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
  if (sourceLabel === "") {
    return getCompactPathLabel(resourcePath, sourceInfo);
  }

  const shortPath = toPosix(getShortPath(resourcePath, sourceInfo));
  const packagePath = shortPath.startsWith("extensions/")
    ? shortPath.slice("extensions/".length)
    : shortPath;
  const parsedPath = posixParse(packagePath);
  if (parsedPath.name !== "index") {
    return `${sourceLabel}:${packagePath}`;
  }
  return parsedPath.dir === "" || parsedPath.dir === "."
    ? sourceLabel
    : `${sourceLabel}:${parsedPath.dir}`;
}

function getUniqueSuffixLabel(segments: string[], others: string[][]): string {
  for (let count = 1; count <= segments.length; count += 1) {
    const candidate = segments.slice(-count).join("/");
    if (others.every((other) => other.slice(-count).join("/") !== candidate)) {
      return candidate;
    }
  }
  return segments.join("/");
}

function getCompactExtensionLabels(
  extensions: readonly loadedResourcesTypes.ResourceItem[],
): string[] {
  const localSegments = new Map<string, string[]>();
  for (const extension of extensions) {
    if (isPackageSource(extension.sourceInfo)) continue;
    const segments = pathSegments(abbreviateHomePath(extension.path));
    const last = segments.at(-1);
    if (segments.length > 1 && (last === "index.ts" || last === "index.js")) {
      segments.pop();
    }
    localSegments.set(extension.path, segments);
  }

  return extensions.map((extension) => {
    if (isPackageSource(extension.sourceInfo)) {
      return getCompactPackageExtensionLabel(extension.path, extension.sourceInfo);
    }
    const segments = localSegments.get(extension.path);
    if (segments === undefined || segments.length === 0) {
      return getCompactPathLabel(extension.path);
    }
    const others = [...localSegments]
      .filter(([otherPath]) => otherPath !== extension.path)
      .map(([, otherSegments]) => otherSegments);
    return getUniqueSuffixLabel(segments, others);
  });
}

function getSourceLabel(sourceInfo: sourceInfoTypes.SourceInfo): string {
  const source = sourceInfo.source ?? "local";
  const scope = sourceInfo.scope ?? "project";
  const scopeLabel = scope === "temporary" ? "temp" : scope;
  if (source === "local") {
    if (scope === "temporary") return "path (temp)";
    return scope === "user" || scope === "project" ? scope : "path";
  }
  if (source === "cli") {
    return scope === "temporary" ? "path (temp)" : "path";
  }
  return scopeLabel === "user" || scopeLabel === "project" || scopeLabel === "temp"
    ? `${source} (${scopeLabel})`
    : source;
}

function getScopeName(
  sourceInfo?: sourceInfoTypes.SourceInfo,
): loadedResourcesInternalTypes.ScopeName {
  const source = sourceInfo?.source ?? "local";
  const scope = sourceInfo?.scope ?? "project";
  if (source === "cli" || scope === "temporary") return "path";
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "path";
}

function buildScopeGroups(
  items: readonly loadedResourcesTypes.ResourceItem[],
): loadedResourcesInternalTypes.ScopeGroup[] {
  const groups: Record<
    loadedResourcesInternalTypes.ScopeName,
    loadedResourcesInternalTypes.ScopeGroup
  > = {
    path: { packages: new Map(), paths: [], scope: "path" },
    project: { packages: new Map(), paths: [], scope: "project" },
    user: { packages: new Map(), paths: [], scope: "user" },
  };

  for (const item of items) {
    const group = groups[getScopeName(item.sourceInfo)];
    if (isPackageSource(item.sourceInfo)) {
      const source = item.sourceInfo?.source ?? "local";
      const list = group.packages.get(source) ?? [];
      list.push(item);
      group.packages.set(source, list);
    } else {
      group.paths.push(item);
    }
  }

  return [groups.project, groups.user, groups.path].filter(
    (group) => group.paths.length > 0 || group.packages.size > 0,
  );
}

const byPath = (
  a: loadedResourcesTypes.ResourceItem,
  b: loadedResourcesTypes.ResourceItem,
): number => a.path.localeCompare(b.path);

function formatScopeGroups(
  groups: readonly loadedResourcesInternalTypes.ScopeGroup[],
  formatPath: (item: loadedResourcesTypes.ResourceItem) => string,
  formatPackagePath: (item: loadedResourcesTypes.ResourceItem) => string,
): string {
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(`  ${theme.fg("accent", group.scope)}`);
    for (const item of [...group.paths].sort(byPath)) {
      lines.push(theme.fg("dim", `    ${formatPath(item)}`));
    }
    const packages = [...group.packages].sort(([a], [b]) => a.localeCompare(b));
    for (const [source, items] of packages) {
      lines.push(`    ${theme.fg("mdLink", source)}`);
      for (const item of [...items].sort(byPath)) {
        lines.push(theme.fg("dim", `      ${formatPackagePath(item)}`));
      }
    }
  }
  return lines.join("\n");
}

function findSourceInfoForPath(
  p: string,
  sourceInfos: ReadonlyMap<string, sourceInfoTypes.SourceInfo>,
): sourceInfoTypes.SourceInfo | undefined {
  let current = p;
  while (true) {
    const match = sourceInfos.get(current);
    if (match !== undefined) return match;
    const parentEnd = current.lastIndexOf("/");
    if (parentEnd === -1) return undefined;
    current = current.substring(0, parentEnd);
  }
}

function formatPathWithSource(
  p: string,
  sourceInfos: ReadonlyMap<string, sourceInfoTypes.SourceInfo>,
): string {
  const sourceInfo = findSourceInfoForPath(p, sourceInfos);
  if (sourceInfo === undefined) return abbreviateHomePath(p);
  return `${getSourceLabel(sourceInfo)} ${getShortPath(p, sourceInfo)}`;
}

const loadedResourcesPart1 = {
  buildScopeGroups,
  formatContextPath,
  formatExtensionDisplayPath,
  formatPathWithSource,
  formatScopeGroups,
  getCompactExtensionLabels,
  getShortPath,
  getStartupVisibility,
};

export default loadedResourcesPart1;
