import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type sourceInfoTypes from "../../../core/source-info.types.ts";
import pathsModule from "../../../utils/paths.ts";
import ExpandableText from "../components/expandable-text.ts";
import ThemedText from "../components/themed-text.ts";
import type loadedResourcesTypes from "../loaded-resources.types.ts";
import themeModule from "../theme/theme.ts";
import resourceFormat from "./resource-format.ts";
import resourceLabels from "./resource-labels.ts";

const { Spacer } = tui;
const { theme } = themeModule;
const { abbreviateHomePath } = pathsModule;
const { buildScopeGroups, formatCompactList, formatDiagnostics, formatScopeGroups } =
  resourceFormat;
const { formatContextPath, formatExtensionDisplayPath, getCompactExtensionLabels, getShortPath } =
  resourceLabels;

type Item = loadedResourcesTypes.ResourceItem;
type Diagnostic = Parameters<typeof formatDiagnostics>[0][number];
type Named = { name: string; filePath: string; sourceInfo: sourceInfoTypes.SourceInfo };

export default class ResourceListing {
  private readonly container: tuiTypes.Container;

  private readonly options: loadedResourcesTypes.LoadedResourcesOptions;

  private readonly sourceInfos: ReadonlyMap<string, sourceInfoTypes.SourceInfo>;

  constructor(
    container: tuiTypes.Container,
    options: loadedResourcesTypes.LoadedResourcesOptions,
    sourceInfos: ReadonlyMap<string, sourceInfoTypes.SourceInfo>,
  ) {
    this.container = container;
    this.options = options;
    this.sourceInfos = sourceInfos;
  }

  private sectionHeader(name: string, color: "mdHeading" | "warning"): string {
    return theme.fg(color, `[${name}]`);
  }

  private addSection(name: string, collapsedBody: () => string, expandedBody: () => string): void {
    this.container.addChild(
      new ExpandableText(
        () => `${this.sectionHeader(name, "mdHeading")}\n${collapsedBody()}`,
        () => `${this.sectionHeader(name, "mdHeading")}\n${expandedBody()}`,
        this.options.expanded,
      ),
    );
    this.container.addChild(new Spacer(1));
  }

  addDiagnostics(title: string, diagnostics: readonly Diagnostic[]): void {
    if (diagnostics.length === 0) return;
    this.container.addChild(
      new ThemedText(
        () =>
          `${this.sectionHeader(title, "warning")}\n${formatDiagnostics(diagnostics, this.sourceInfos)}`,
        0,
        0,
      ),
    );
    this.container.addChild(new Spacer(1));
  }

  listContext(contextFiles: readonly { path: string }[]): void {
    if (contextFiles.length === 0) return;
    this.container.addChild(new Spacer(1));
    this.addSection(
      "Context",
      () =>
        formatCompactList(
          contextFiles.map((file) => formatContextPath(file.path, this.options.cwd)),
          false,
        ),
      () =>
        contextFiles
          .map((file) => theme.fg("dim", `  ${abbreviateHomePath(file.path)}`))
          .join("\n"),
    );
  }

  listSkills(
    skills: readonly { name: string; filePath: string; sourceInfo: sourceInfoTypes.SourceInfo }[],
  ): void {
    if (skills.length === 0) return;
    const groups = buildScopeGroups(
      skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })),
    );
    this.addSection(
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

  listPrompts(templates: readonly Named[]): void {
    if (templates.length === 0) return;
    const groups = buildScopeGroups(
      templates.map((template) => ({ path: template.filePath, sourceInfo: template.sourceInfo })),
    );
    const templateByPath = new Map(templates.map((template) => [template.filePath, template]));
    const formatTemplate = (item: Item) => {
      const template = templateByPath.get(item.path);
      return template === undefined ? abbreviateHomePath(item.path) : `/${template.name}`;
    };
    this.addSection(
      "Prompts",
      () => formatCompactList(templates.map((template) => `/${template.name}`)),
      () => formatScopeGroups(groups, formatTemplate, formatTemplate),
    );
  }

  listExtensions(extensions: readonly Item[]): void {
    if (extensions.length === 0) return;
    const groups = buildScopeGroups(extensions);
    const labels = getCompactExtensionLabels(extensions);
    this.addSection(
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
