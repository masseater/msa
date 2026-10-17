import * as path from "node:path";

import { type Container, Spacer } from "@msa/tui";

import type { PromptTemplate } from "../../core/prompt-templates.ts";
import type { ResourceDiagnostic, ResourceLoader } from "../../core/resource-loader.ts";
import type { QuietStartup } from "../../core/settings-manager.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import { parseGitUrl } from "../../utils/git.ts";
import { abbreviateHomePath, getCwdRelativePath } from "../../utils/paths.ts";
import { ExpandableText } from "./components/expandable-text.ts";
import { ThemedText } from "./components/themed-text.ts";
import { type ThemeColor, theme } from "./theme/theme.ts";

type ResourceItem = { path: string; sourceInfo?: SourceInfo };
type ScopeName = "user" | "project" | "path";
type ScopeGroup = {
  scope: ScopeName;
  paths: ResourceItem[];
  packages: Map<string, ResourceItem[]>;
};

/** Which parts of the startup screen a `quietStartup` setting keeps. `verbose` shows everything. */
export function getStartupVisibility(
  quietStartup: QuietStartup | undefined,
  verbose: boolean,
): { header: boolean; details: boolean } {
  return {
    header: verbose || quietStartup !== true,
    details: verbose || quietStartup === false,
  };
}

const toPosix = (p: string): string => p.replace(/\\/g, "/");

function isPackageSource(sourceInfo?: SourceInfo): boolean {
  const source = sourceInfo?.source ?? "";
  return source.startsWith("npm:") || source.startsWith("git:");
}

function formatExtensionDisplayPath(p: string): string {
  return abbreviateHomePath(p)
    .replace(/\/index\.ts$/, "")
    .replace(/\/index\.js$/, "");
}

function formatContextPath(p: string, cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(resolvedCwd, p);
  return getCwdRelativePath(absolutePath, resolvedCwd) ?? abbreviateHomePath(absolutePath);
}

/** A path relative to the package that provided it, or the home-abbreviated path for local resources. */
function getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
  const normalizedFullPath = toPosix(fullPath);
  const baseDir = sourceInfo?.baseDir;
  if (baseDir && isPackageSource(sourceInfo)) {
    const normalizedBaseDir = toPosix(baseDir);
    const npmRootMatch = normalizedBaseDir.match(/^(.*\/node_modules)\/(@?[^/]+(?:\/[^/]+)?)$/);
    // A sibling under the same node_modules root keeps its position relative to the declaring package.
    if (npmRootMatch?.[1] && normalizedFullPath.startsWith(`${npmRootMatch[1]}/`)) {
      return path.posix.relative(normalizedBaseDir, normalizedFullPath);
    }

    const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
    if (
      relativePath &&
      relativePath !== "." &&
      !relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath)
    ) {
      return toPosix(relativePath);
    }
  }

  const source = sourceInfo?.source ?? "";
  const npmMatch = normalizedFullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
  if (npmMatch && source.startsWith("npm:")) {
    return npmMatch[2]!;
  }

  const gitMatch = normalizedFullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
  if (gitMatch && source.startsWith("git:")) {
    return gitMatch[1]!;
  }

  return abbreviateHomePath(fullPath);
}

function pathSegments(p: string): string[] {
  return toPosix(p)
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "~");
}

function getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
  const shortPath = getShortPath(resourcePath, sourceInfo);
  return pathSegments(shortPath).at(-1) ?? shortPath;
}

function getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
  const source = sourceInfo?.source ?? "";
  if (source.startsWith("npm:")) {
    return source.slice("npm:".length) || source;
  }
  return parseGitUrl(source)?.path || source;
}

function getCompactPackageExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
  const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
  if (!sourceLabel) {
    return getCompactPathLabel(resourcePath, sourceInfo);
  }

  const shortPath = toPosix(getShortPath(resourcePath, sourceInfo));
  const packagePath = shortPath.startsWith("extensions/")
    ? shortPath.slice("extensions/".length)
    : shortPath;
  const parsedPath = path.posix.parse(packagePath);
  if (parsedPath.name !== "index") {
    return `${sourceLabel}:${packagePath}`;
  }
  return !parsedPath.dir || parsedPath.dir === "."
    ? sourceLabel
    : `${sourceLabel}:${parsedPath.dir}`;
}

/** The shortest trailing run of path segments that no other local extension shares. */
function getUniqueSuffixLabel(segments: string[], others: string[][]): string {
  for (let count = 1; count <= segments.length; count += 1) {
    const candidate = segments.slice(-count).join("/");
    if (others.every((other) => other.slice(-count).join("/") !== candidate)) {
      return candidate;
    }
  }
  return segments.join("/");
}

function getCompactExtensionLabels(extensions: readonly ResourceItem[]): string[] {
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
    if (!segments || segments.length === 0) {
      return getCompactPathLabel(extension.path);
    }
    const others = [...localSegments]
      .filter(([otherPath]) => otherPath !== extension.path)
      .map(([, otherSegments]) => otherSegments);
    return getUniqueSuffixLabel(segments, others);
  });
}

function getSourceLabel(sourceInfo: SourceInfo): string {
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

function getScopeName(sourceInfo?: SourceInfo): ScopeName {
  const source = sourceInfo?.source ?? "local";
  const scope = sourceInfo?.scope ?? "project";
  if (source === "cli" || scope === "temporary") return "path";
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "path";
}

function buildScopeGroups(items: readonly ResourceItem[]): ScopeGroup[] {
  const groups: Record<ScopeName, ScopeGroup> = {
    user: { scope: "user", paths: [], packages: new Map() },
    project: { scope: "project", paths: [], packages: new Map() },
    path: { scope: "path", paths: [], packages: new Map() },
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

const byPath = (a: ResourceItem, b: ResourceItem): number => a.path.localeCompare(b.path);

function formatScopeGroups(
  groups: readonly ScopeGroup[],
  formatPath: (item: ResourceItem) => string,
  formatPackagePath: (item: ResourceItem) => string,
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
  sourceInfos: ReadonlyMap<string, SourceInfo>,
): SourceInfo | undefined {
  let current = p;
  while (true) {
    const match = sourceInfos.get(current);
    if (match) return match;
    const parentEnd = current.lastIndexOf("/");
    if (parentEnd === -1) return undefined;
    current = current.substring(0, parentEnd);
  }
}

function formatPathWithSource(p: string, sourceInfos: ReadonlyMap<string, SourceInfo>): string {
  const sourceInfo = findSourceInfoForPath(p, sourceInfos);
  if (!sourceInfo) return abbreviateHomePath(p);
  return `${getSourceLabel(sourceInfo)} ${getShortPath(p, sourceInfo)}`;
}

function formatDiagnostics(
  diagnostics: readonly ResourceDiagnostic[],
  sourceInfos: ReadonlyMap<string, SourceInfo>,
): string {
  const lines: string[] = [];
  const collisions = new Map<string, ResourceDiagnostic[]>();
  const otherDiagnostics: ResourceDiagnostic[] = [];
  for (const d of diagnostics) {
    if (d.type === "collision" && d.collision) {
      const list = collisions.get(d.collision.name) ?? [];
      list.push(d);
      collisions.set(d.collision.name, list);
    } else {
      otherDiagnostics.push(d);
    }
  }

  for (const [name, collisionList] of collisions) {
    const first = collisionList[0]?.collision;
    if (!first) continue;
    lines.push(theme.fg("warning", `  "${name}" collision:`));
    lines.push(
      theme.fg(
        "dim",
        `    ${theme.fg("success", "✓")} ${formatPathWithSource(first.winnerPath, sourceInfos)}`,
      ),
    );
    for (const d of collisionList) {
      if (!d.collision) continue;
      lines.push(
        theme.fg(
          "dim",
          `    ${theme.fg("warning", "✗")} ${formatPathWithSource(d.collision.loserPath, sourceInfos)} (skipped)`,
        ),
      );
    }
  }

  for (const d of otherDiagnostics) {
    const color = d.type === "error" ? "error" : "warning";
    if (d.path) {
      lines.push(theme.fg(color, `  ${formatPathWithSource(d.path, sourceInfos)}`));
      lines.push(theme.fg(color, `    ${d.message}`));
    } else {
      lines.push(theme.fg(color, `  ${d.message}`));
    }
  }
  return lines.join("\n");
}

function formatCompactList(items: readonly string[], sort = true): string {
  const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (sort) {
    labels.sort((a, b) => a.localeCompare(b));
  }
  return theme.fg("dim", `  ${labels.join(", ")}`);
}

export type LoadedResourcesSource = {
  resourceLoader: Pick<
    ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >;
  promptTemplates: readonly PromptTemplate[];
  /** Command and shortcut problems the extension runner found after binding. */
  extensionRunnerDiagnostics: readonly ResourceDiagnostic[];
};

export type LoadedResourcesOptions = {
  cwd: string;
  expanded: boolean;
  showListing: boolean;
  showDiagnostics: boolean;
  /** Extensions to list instead of the visible ones the resource loader holds. */
  extensions?: readonly ResourceItem[] | undefined;
};

/**
 * Replaces the contents of `container` with the startup listing of loaded context files, skills,
 * prompts, and extensions, followed by their diagnostics. Bodies are built on demand so they follow
 * theme changes.
 */
export function renderLoadedResources(
  container: Container,
  source: LoadedResourcesSource,
  options: LoadedResourcesOptions,
): void {
  container.clear();
  if (!options.showListing && !options.showDiagnostics) {
    return;
  }

  const { resourceLoader } = source;
  const skillsResult = resourceLoader.getSkills();
  const promptsResult = resourceLoader.getPrompts();
  const themesResult = resourceLoader.getThemes();
  const extensionsResult = resourceLoader.getExtensions();
  const extensions =
    options.extensions ??
    extensionsResult.extensions
      .filter((extension) => !extension.hidden)
      .map((extension) => ({ path: extension.path, sourceInfo: extension.sourceInfo }));

  const sourceInfos = new Map<string, SourceInfo>();
  const addSourceInfo = (p: string | undefined, sourceInfo: SourceInfo | undefined) => {
    if (p && sourceInfo) sourceInfos.set(p, sourceInfo);
  };
  for (const extension of extensions) addSourceInfo(extension.path, extension.sourceInfo);
  for (const skill of skillsResult.skills) addSourceInfo(skill.filePath, skill.sourceInfo);
  for (const prompt of promptsResult.prompts) addSourceInfo(prompt.filePath, prompt.sourceInfo);
  for (const loadedTheme of themesResult.themes) {
    addSourceInfo(loadedTheme.sourcePath, loadedTheme.sourceInfo);
  }

  const sectionHeader = (name: string, color: ThemeColor) => theme.fg(color, `[${name}]`);
  const addSection = (name: string, collapsedBody: () => string, expandedBody: () => string) => {
    container.addChild(
      new ExpandableText(
        () => `${sectionHeader(name, "mdHeading")}\n${collapsedBody()}`,
        () => `${sectionHeader(name, "mdHeading")}\n${expandedBody()}`,
        options.expanded,
      ),
    );
    container.addChild(new Spacer(1));
  };
  const addDiagnostics = (title: string, diagnostics: readonly ResourceDiagnostic[]) => {
    if (diagnostics.length === 0) return;
    container.addChild(
      new ThemedText(
        () => `${sectionHeader(title, "warning")}\n${formatDiagnostics(diagnostics, sourceInfos)}`,
        0,
        0,
      ),
    );
    container.addChild(new Spacer(1));
  };

  if (options.showListing) {
    const systemPromptSource = resourceLoader.getSystemPromptSource();
    const contextFiles = [
      ...(systemPromptSource ? [systemPromptSource] : []),
      ...resourceLoader.getAppendSystemPromptSources(),
      ...resourceLoader.getAgentsFiles().agentsFiles,
    ];
    if (contextFiles.length > 0) {
      container.addChild(new Spacer(1));
      addSection(
        "Context",
        () =>
          formatCompactList(
            contextFiles.map((file) => formatContextPath(file.path, options.cwd)),
            false,
          ),
        () =>
          contextFiles
            .map((file) => theme.fg("dim", `  ${abbreviateHomePath(file.path)}`))
            .join("\n"),
      );
    }

    const skills = skillsResult.skills;
    if (skills.length > 0) {
      const groups = buildScopeGroups(
        skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })),
      );
      addSection(
        "Skills",
        () => formatCompactList(skills.map((skill) => skill.name)),
        () =>
          formatScopeGroups(
            groups,
            (item) => abbreviateHomePath(item.path),
            (item) => getShortPath(item.path, item.sourceInfo),
          ),
      );
    }

    const templates = source.promptTemplates;
    if (templates.length > 0) {
      const groups = buildScopeGroups(
        templates.map((template) => ({ path: template.filePath, sourceInfo: template.sourceInfo })),
      );
      const templateByPath = new Map(templates.map((template) => [template.filePath, template]));
      const formatTemplate = (item: ResourceItem) => {
        const template = templateByPath.get(item.path);
        return template ? `/${template.name}` : abbreviateHomePath(item.path);
      };
      addSection(
        "Prompts",
        () => formatCompactList(templates.map((template) => `/${template.name}`)),
        () => formatScopeGroups(groups, formatTemplate, formatTemplate),
      );
    }

    if (extensions.length > 0) {
      const groups = buildScopeGroups(extensions);
      const labels = getCompactExtensionLabels(extensions);
      addSection(
        "Extensions",
        () => formatCompactList(labels),
        () =>
          formatScopeGroups(
            groups,
            (item) => formatExtensionDisplayPath(item.path),
            (item) => formatExtensionDisplayPath(getShortPath(item.path, item.sourceInfo)),
          ),
      );
    }
  }

  if (options.showDiagnostics) {
    addDiagnostics("Skill conflicts", skillsResult.diagnostics);
    addDiagnostics("Prompt conflicts", promptsResult.diagnostics);
    addDiagnostics("Extension issues", [
      ...extensionsResult.errors.map((error) => ({
        type: "error" as const,
        message: error.error,
        path: error.path,
      })),
      ...(extensionsResult.warnings ?? []).map((warning) => ({
        type: "warning" as const,
        message: warning.warning,
        path: warning.path,
      })),
      ...source.extensionRunnerDiagnostics,
    ]);
    addDiagnostics("Theme conflicts", themesResult.diagnostics);
  }
}
