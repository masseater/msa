import platform from "../../../core/platform/index.ts";
import type sourceInfoTypes from "../../../core/source-info.types.ts";
import git from "../../../utils/git.ts";
import pathsModule from "../../../utils/paths.ts";
import type loadedResourcesTypes from "../loaded-resources.types.ts";

const { abbreviateHomePath, getCwdRelativePath } = pathsModule;
const { isAbsolute, posix, relative, resolve } = platform;
const { parseGitUrl } = git;

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
      return posix.relative(normalizedBaseDir, normalizedFullPath);
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
  const parsedPath = posix.parse(packagePath);
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

const resourceLabels = {
  formatContextPath,
  formatExtensionDisplayPath,
  getCompactExtensionLabels,
  getCompactPackageExtensionLabel,
  getCompactPackageSourceLabel,
  getCompactPathLabel,
  getShortPath,
  getSourceLabel,
  getUniqueSuffixLabel,
  isPackageSource,
  pathSegments,
  toPosix,
};

export default resourceLabels;
