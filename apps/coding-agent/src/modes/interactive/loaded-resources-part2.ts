import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";
import ExpandableText from "./components/expandable-text.ts";
import loadedResourcesPart1 from "./loaded-resources-part1.ts";
import type loadedResourcesTypes from "./loaded-resources.types.ts";
import themeModule from "./theme/theme.ts";
import type themeTypes from "./theme/theme.types.ts";

const { theme } = themeModule;
const { Spacer } = tui;
const { formatPathWithSource } = loadedResourcesPart1;

function formatDiagnostics(
  diagnostics: readonly resourceLoaderTypes.ResourceDiagnostic[],
  sourceInfos: ReadonlyMap<string, sourceInfoTypes.SourceInfo>,
): string {
  const lines: string[] = [];
  const collisions = new Map<string, resourceLoaderTypes.ResourceDiagnostic[]>();
  const otherDiagnostics: resourceLoaderTypes.ResourceDiagnostic[] = [];
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

function buildSectionHeaderSectionHeaderSectionHeaderPart5(
  resourceLoader: Pick<
    resourceLoaderTypes.ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  addSection: any;
  extensions: any;
  extensionsResult: any;
  promptsResult: any;
  sectionHeader: any;
  skillsResult: any;
  sourceInfos: any;
  themesResult: any;
} {
  return buildSectionHeaderSectionHeaderSectionHeaderPart4(resourceLoader, options, container);
}

function buildSectionHeaderSectionHeaderSectionHeaderPart4(
  resourceLoader: Pick<
    resourceLoaderTypes.ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  addSection: any;
  extensions: any;
  extensionsResult: any;
  promptsResult: any;
  sectionHeader: any;
  skillsResult: any;
  sourceInfos: any;
  themesResult: any;
} {
  return buildSectionHeaderSectionHeaderSectionHeaderPart3(resourceLoader, options, container);
}

function buildSectionHeaderSectionHeaderSectionHeaderPart3(
  resourceLoader: Pick<
    resourceLoaderTypes.ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  addSection: any;
  extensions: any;
  extensionsResult: any;
  promptsResult: any;
  sectionHeader: any;
  skillsResult: any;
  sourceInfos: any;
  themesResult: any;
} {
  return buildSectionHeaderSectionHeaderSectionHeaderPart2(resourceLoader, options, container);
}

function buildSectionHeaderSectionHeaderSectionHeaderPart2(
  resourceLoader: Pick<
    resourceLoaderTypes.ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
): {
  addSection: any;
  extensions: any;
  extensionsResult: any;
  promptsResult: any;
  sectionHeader: any;
  skillsResult: any;
  sourceInfos: any;
  themesResult: any;
} {
  return buildSectionHeaderSectionHeaderSectionHeaderPart1(resourceLoader, options, container);
}

function buildSectionHeaderSectionHeaderSectionHeaderPart1(
  resourceLoader: Pick<
    resourceLoaderTypes.ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  options: loadedResourcesTypes.LoadedResourcesOptions,
  container: tuiTypes.Container,
) {
  const skillsResult = resourceLoader.getSkills();
  const promptsResult = resourceLoader.getPrompts();
  const { extensions, addSourceInfo, themesResult, extensionsResult, sourceInfos } =
    buildSectionHeaderSectionHeaderSectionHeaderPart1Part1(resourceLoader, options);
  for (const extension of extensions) addSourceInfo(extension.path, extension.sourceInfo);
  for (const skill of skillsResult.skills) addSourceInfo(skill.filePath, skill.sourceInfo);
  for (const prompt of promptsResult.prompts) addSourceInfo(prompt.filePath, prompt.sourceInfo);
  for (const loadedTheme of themesResult.themes) {
    addSourceInfo(loadedTheme.sourcePath, loadedTheme.sourceInfo);
  }

  const sectionHeader = (name: string, color: themeTypes.ThemeColor) =>
    theme.fg(color, `[${name}]`);
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
    sectionHeader,
    skillsResult,
    sourceInfos,
    themesResult,
  };
}

function buildSectionHeaderSectionHeaderSectionHeaderPart1Part1(
  resourceLoader: Pick<
    resourceLoaderTypes.ResourceLoader,
    | "getSkills"
    | "getPrompts"
    | "getThemes"
    | "getExtensions"
    | "getSystemPromptSource"
    | "getAppendSystemPromptSources"
    | "getAgentsFiles"
  >,
  options: loadedResourcesTypes.LoadedResourcesOptions,
) {
  const themesResult = resourceLoader.getThemes();
  const extensionsResult = resourceLoader.getExtensions();
  const extensions =
    options.extensions ??
    extensionsResult.extensions
      .filter((extension) => extension.hidden !== true)
      .map((extension) => ({ path: extension.path, sourceInfo: extension.sourceInfo }));

  const sourceInfos = new Map<string, sourceInfoTypes.SourceInfo>();
  const addSourceInfo = (
    p: string | undefined,
    sourceInfo: sourceInfoTypes.SourceInfo | undefined,
  ) => {
    if (p !== undefined && p !== "" && sourceInfo !== undefined) sourceInfos.set(p, sourceInfo);
  };
  return { addSourceInfo, extensions, extensionsResult, sourceInfos, themesResult };
}

const loadedResourcesPart2 = {
  buildSectionHeaderSectionHeaderSectionHeaderPart5,
  formatCompactList,
  formatDiagnostics,
};

export default loadedResourcesPart2;
