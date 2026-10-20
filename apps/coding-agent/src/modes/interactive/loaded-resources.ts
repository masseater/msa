import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import type { LoadExtensionsResult } from "../../core/extensions/types.ts";
import type { PromptTemplate } from "../../core/prompt-templates.ts";
import type { ResourceDiagnostic, ResourceLoader } from "../../core/resource-loader.ts";
import type { QuietStartup } from "../../core/settings-manager.ts";
import type { Skill } from "../../core/skills.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import { parseGitUrl } from "../../utils/git.ts";
import { abbreviateHomePath, getCwdRelativePath } from "../../utils/paths.ts";
import { isAbsolute, posixParse, posixRelative, relative, resolve } from "../path.ts";
import { ExpandableText } from "./components/expandable-text.ts";
import { ThemedText } from "./components/themed-text.ts";
import type { Theme } from "./theme/theme.ts";
import { type ThemeColor, theme } from "./theme/theme.ts";

const { Spacer } = tui;

type ResourceItem = { path: string; sourceInfo?: SourceInfo };
type ScopeName = "user" | "project" | "path";
type ScopeGroup = {
  scope: ScopeName;
  paths: ResourceItem[];
  packages: Map<string, ResourceItem[]>;
};

export const getStartupVisibility: {
  (
    verbose: boolean,
  ): (quietStartup: QuietStartup | undefined) => { header: boolean; details: boolean };
  (quietStartup: QuietStartup | undefined, verbose: boolean): { header: boolean; details: boolean };
} = dual(
  2,
  (
    quietStartup: QuietStartup | undefined,
    verbose: boolean,
  ): { header: boolean; details: boolean } => ({
    details: verbose || quietStartup === false,
    header: verbose || quietStartup !== true,
  }),
);

const toPosix = (p: string): string => p.replace(/\\/gu, "/");

function isPackageSource(sourceInfo?: SourceInfo): boolean {
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

function getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
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
    if (segments === undefined || segments.length === 0) {
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
    if (match !== undefined) return match;
    const parentEnd = current.lastIndexOf("/");
    if (parentEnd === -1) return undefined;
    current = current.substring(0, parentEnd);
  }
}

function formatPathWithSource(p: string, sourceInfos: ReadonlyMap<string, SourceInfo>): string {
  const sourceInfo = findSourceInfoForPath(p, sourceInfos);
  if (sourceInfo === undefined) return abbreviateHomePath(p);
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
    if (d.type === "collision" && d.collision !== undefined) {
      const list = collisions.get(d.collision.name) ?? [];
      list.push(d);
      collisions.set(d.collision.name, list);
    } else {
      otherDiagnostics.push(d);
    }
  }

  for (const [name, collisionList] of collisions) {
    const first = collisionList[0]?.collision;
    if (first === undefined) continue;
    lines.push(theme.fg("warning", `  "${name}" collision:`));
    lines.push(
      theme.fg(
        "dim",
        `    ${theme.fg("success", "✓")} ${formatPathWithSource(first.winnerPath, sourceInfos)}`,
      ),
    );
    for (const d of collisionList) {
      if (d.collision === undefined) continue;
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
    if (d.path !== undefined && d.path !== "") {
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
  extensionRunnerDiagnostics: readonly ResourceDiagnostic[];
};

export type LoadedResourcesOptions = {
  cwd: string;
  expanded: boolean;
  showListing: boolean;
  showDiagnostics: boolean;
  extensions?: readonly ResourceItem[] | undefined;
};

export const renderLoadedResources: {
  (
    source: LoadedResourcesSource,
    options: LoadedResourcesOptions,
  ): (container: tuiTypes.Container) => void;
  (
    container: tuiTypes.Container,
    source: LoadedResourcesSource,
    options: LoadedResourcesOptions,
  ): void;
} = dual(
  3,
  (
    container: tuiTypes.Container,
    source: LoadedResourcesSource,
    options: LoadedResourcesOptions,
  ): void => {
    container.clear();
    if (!options.showListing && !options.showDiagnostics) {
      return;
    }

    const { addDiagnostics, skillsResult, promptsResult, extensionsResult, themesResult } =
      buildAddDiagnostics(source, options, container);

    buildPart4(
      options,
      addDiagnostics,
      skillsResult,
      promptsResult,
      extensionsResult,
      source,
      themesResult,
    );
  },
);

function buildAddDiagnostics(
  source: LoadedResourcesSource,
  options: LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  addDiagnostics: (title: string, diagnostics: readonly ResourceDiagnostic[]) => void;
  skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  extensionsResult: LoadExtensionsResult;
  themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
} {
  const {
    sectionHeader,
    sourceInfos,
    resourceLoader,
    addSection,
    skillsResult,
    extensions,
    promptsResult,
    extensionsResult,
    themesResult,
  } = buildSectionHeader(source, options, container);
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
    const templates = buildTemplates(
      resourceLoader,
      container,
      addSection,
      options,
      skillsResult,
      source,
    );
    buildPart3(templates, addSection, extensions);
  }
  return { addDiagnostics, extensionsResult, promptsResult, skillsResult, themesResult };
}

function buildSectionHeader(
  source: LoadedResourcesSource,
  options: LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  sectionHeader: (name: string, color: ThemeColor) => string;
  sourceInfos: Map<string, SourceInfo>;
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
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void;
  skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  extensions: readonly ResourceItem[];
  promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  extensionsResult: LoadExtensionsResult;
  themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
} {
  const {
    sectionHeader,
    sourceInfos,
    resourceLoader,
    addSection,
    skillsResult,
    extensions,
    promptsResult,
    extensionsResult,
    themesResult,
  } = buildSectionHeaderSectionHeader(source, options, container);
  return {
    addSection,
    extensions,
    extensionsResult,
    promptsResult,
    resourceLoader,
    sectionHeader,
    skillsResult,
    sourceInfos,
    themesResult,
  };
}

function buildSectionHeaderSectionHeader(
  source: LoadedResourcesSource,
  options: LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  sectionHeader: (name: string, color: ThemeColor) => string;
  sourceInfos: Map<string, SourceInfo>;
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
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void;
  skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  extensions: readonly ResourceItem[];
  promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  extensionsResult: LoadExtensionsResult;
  themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
} {
  const {
    sectionHeader,
    sourceInfos,
    resourceLoader,
    addSection,
    skillsResult,
    extensions,
    promptsResult,
    extensionsResult,
    themesResult,
  } = buildSectionHeaderSectionHeaderSectionHeader(source, options, container);
  return {
    addSection,
    extensions,
    extensionsResult,
    promptsResult,
    resourceLoader,
    sectionHeader,
    skillsResult,
    sourceInfos,
    themesResult,
  };
}

function buildSectionHeaderSectionHeaderSectionHeader(
  source: LoadedResourcesSource,
  options: LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  sectionHeader: (name: string, color: ThemeColor) => string;
  sourceInfos: Map<string, SourceInfo>;
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
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void;
  skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  extensions: readonly ResourceItem[];
  promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  extensionsResult: LoadExtensionsResult;
  themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
} {
  const { resourceLoader } = source;
  const skillsResult = resourceLoader.getSkills();
  const promptsResult = resourceLoader.getPrompts();
  const themesResult = resourceLoader.getThemes();
  const extensionsResult = resourceLoader.getExtensions();
  const extensions =
    options.extensions ??
    extensionsResult.extensions
      .filter((extension) => extension.hidden !== true)
      .map((extension) => ({ path: extension.path, sourceInfo: extension.sourceInfo }));

  const sourceInfos = new Map<string, SourceInfo>();
  const addSourceInfo = (p: string | undefined, sourceInfo: SourceInfo | undefined) => {
    if (p !== undefined && p !== "" && sourceInfo !== undefined) sourceInfos.set(p, sourceInfo);
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
  return {
    addSection,
    extensions,
    extensionsResult,
    promptsResult,
    resourceLoader,
    sectionHeader,
    skillsResult,
    sourceInfos,
    themesResult,
  };
}

function buildTemplates(
  resourceLoader: Pick<
    ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  container: tuiTypes.Container,
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
  options: LoadedResourcesOptions,
  skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] },
  source: LoadedResourcesSource,
): readonly PromptTemplate[] {
  const templates = buildTemplatesTemplates(
    resourceLoader,
    container,
    addSection,
    options,
    skillsResult,
    source,
  );
  return templates;
}

function buildTemplatesTemplates(
  resourceLoader: Pick<
    ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  container: tuiTypes.Container,
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
  options: LoadedResourcesOptions,
  skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] },
  source: LoadedResourcesSource,
): readonly PromptTemplate[] {
  const templates = buildTemplatesTemplatesTemplates(
    resourceLoader,
    container,
    addSection,
    options,
    skillsResult,
    source,
  );
  return templates;
}

function buildTemplatesTemplatesTemplates(
  resourceLoader: Pick<
    ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  container: tuiTypes.Container,
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
  options: LoadedResourcesOptions,
  skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] },
  source: LoadedResourcesSource,
): readonly PromptTemplate[] {
  const systemPromptSource = resourceLoader.getSystemPromptSource();
  const contextFiles = [
    ...(systemPromptSource === undefined ? [] : [systemPromptSource]),
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
  return templates;
}

function buildPart3(
  templates: readonly PromptTemplate[],
  addSection: (name: string, collapsedBody: () => string, expandedBody: () => string) => void,
  extensions: readonly ResourceItem[],
): void {
  if (templates.length > 0) {
    const groups = buildScopeGroups(
      templates.map((template) => ({
        path: template.filePath,
        sourceInfo: template.sourceInfo,
      })),
    );
    const templateByPath = new Map(templates.map((template) => [template.filePath, template]));
    const formatTemplate = (item: ResourceItem) => {
      const template = templateByPath.get(item.path);
      return template === undefined ? abbreviateHomePath(item.path) : `/${template.name}`;
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

function buildPart4(
  options: LoadedResourcesOptions,
  addDiagnostics: (title: string, diagnostics: readonly ResourceDiagnostic[]) => void,
  skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] },
  promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] },
  extensionsResult: LoadExtensionsResult,
  source: LoadedResourcesSource,
  themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] },
): void {
  if (options.showDiagnostics) {
    addDiagnostics("Skill conflicts", skillsResult.diagnostics);
    addDiagnostics("Prompt conflicts", promptsResult.diagnostics);
    addDiagnostics("Extension issues", [
      ...extensionsResult.errors.map((error) => ({
        message: error.error,
        path: error.path,
        type: "error" as const,
      })),
      ...(extensionsResult.warnings ?? []).map((warning) => ({
        message: warning.warning,
        path: warning.path,
        type: "warning" as const,
      })),
      ...source.extensionRunnerDiagnostics,
    ]);
    addDiagnostics("Theme conflicts", themesResult.diagnostics);
  }
}
