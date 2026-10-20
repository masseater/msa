import tui from "@msa/tui";

import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type defaultResourceLoaderInternalTypes from "../default-resource-loader-internal.types.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import type diagnosticsTypes from "../diagnostics.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import sourceInfoModule from "../source-info.ts";
import type sourceInfoTypes from "../source-info.types.ts";
import themeFiles from "./theme-files.ts";
const { detectCapabilities, getTerminalColorMode } = tui;
const { createSourceInfo } = sourceInfoModule;
const { dedupeThemes, loadThemes } = themeFiles;

export default class ThemeResources {
  private readonly owner: DefaultResourceLoader;

  constructor(owner: DefaultResourceLoader) {
    this.owner = owner;
  }

  additionalThemePaths: string[] = [];

  noThemes = false;

  themesOverride!: resourceLoaderTypes.DefaultResourceLoaderOptions["themesOverride"];

  themes: themeTypes.Theme[] = [];

  themeDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  extensionThemeSourceInfos = new Map<string, sourceInfoTypes.SourceInfo>();

  lastThemePaths: string[] = [];

  updateThemesFromPaths(
    themePaths: string[],
    metadataByPath?: Map<string, packageManagerTypes.PathMetadata>,
  ): void {
    let themesResult: {
      themes: themeTypes.Theme[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    };
    if (this.noThemes && themePaths.length === 0) {
      themesResult = { diagnostics: [], themes: [] };
    } else {
      const colorMode = getTerminalColorMode({
        ...detectCapabilities(() => false),
        ...this.owner.environment.settingsManager.terminal.getTerminalCapabilityOverrides(),
      });
      const loaded = loadThemes(
        themePaths.map((p) => this.owner.environment.paths.resolveResourcePath(p)),
        colorMode,
      );
      const deduped = dedupeThemes(loaded.themes);
      themesResult = {
        diagnostics: [...loaded.diagnostics, ...deduped.diagnostics],
        themes: deduped.themes,
      };
    }
    const resolvedThemes =
      this.themesOverride === undefined ? themesResult : this.themesOverride(themesResult);
    this.themes = resolvedThemes.themes.map((theme) => {
      const sourcePath = theme.sourcePath;
      theme.sourceInfo =
        sourcePath !== undefined && sourcePath !== ""
          ? (this.owner.environment.paths.findSourceInfoForPath(
              sourcePath,
              this.extensionThemeSourceInfos,
              metadataByPath,
            ) ??
            theme.sourceInfo ??
            this.owner.environment.paths.getDefaultSourceInfoForPath(sourcePath))
          : theme.sourceInfo;
      return theme;
    });
    this.themeDiagnostics = resolvedThemes.diagnostics;
  }

  configure(options: resourceLoaderTypes.DefaultResourceLoaderOptions): void {
    this.additionalThemePaths = options.additionalThemePaths ?? [];
    this.noThemes = options.noThemes ?? false;
    this.themesOverride = options.themesOverride;
  }

  reload(plan: defaultResourceLoaderInternalTypes.ResourcePlan): void {
    const { paths } = this.owner.environment;
    const { cli, configured } = plan.themes;
    const themePaths = this.noThemes
      ? paths.mergePaths(cli, this.additionalThemePaths)
      : paths.mergePaths([...cli, ...configured], this.additionalThemePaths);
    this.lastThemePaths = themePaths;
    this.updateThemesFromPaths(themePaths, plan.metadataByPath);
    for (const resolved of paths.missingPaths(this.additionalThemePaths, false)) {
      if (this.themeDiagnostics.some((d) => d.path === resolved)) continue;
      this.themeDiagnostics.push({
        message: "Theme path does not exist",
        path: resolved,
        type: "error",
      });
    }
  }

  extend(entries: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>): void {
    for (const entry of entries) {
      this.extensionThemeSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    if (entries.length === 0) return;
    this.lastThemePaths = this.owner.environment.paths.mergePaths(
      this.lastThemePaths,
      entries.map((entry) => entry.path),
    );
    this.updateThemesFromPaths(
      this.lastThemePaths,
      this.owner.environment.paths.resourceMetadataByPath,
    );
  }
}
