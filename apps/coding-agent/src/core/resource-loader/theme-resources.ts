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

  private loadThemesFor(themePaths: string[]): Promise<{
    themes: themeTypes.Theme[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  }> {
    if (this.noThemes && themePaths.length === 0)
      return Promise.resolve({ diagnostics: [], themes: [] });
    const colorMode = getTerminalColorMode({
      ...detectCapabilities(() => false),
      ...this.owner.environment.settingsManager.terminal.getTerminalCapabilityOverrides(),
    });
    return loadThemes(
      themePaths.map((p) => this.owner.environment.paths.resolveResourcePath(p)),
      colorMode,
    ).then((loaded) => {
      const deduped = dedupeThemes(loaded.themes);
      return {
        diagnostics: [...loaded.diagnostics, ...deduped.diagnostics],
        themes: deduped.themes,
      };
    });
  }

  updateThemesFromPaths(
    themePaths: string[],
    metadataByPath?: Map<string, packageManagerTypes.PathMetadata>,
  ): Promise<void> {
    return this.loadThemesFor(themePaths)
      .then((themesResult) =>
        this.themesOverride === undefined ? themesResult : this.themesOverride(themesResult),
      )
      .then((resolvedThemes) =>
        Promise.all(
          resolvedThemes.themes.map((theme) => this.withSourceInfo(theme, metadataByPath)),
        ).then((themes) => {
          this.themes = themes;
          this.themeDiagnostics = resolvedThemes.diagnostics;
          return undefined;
        }),
      );
  }

  private withSourceInfo(
    theme: themeTypes.Theme,
    metadataByPath: Map<string, packageManagerTypes.PathMetadata> | undefined,
  ): Promise<themeTypes.Theme> {
    const { sourcePath } = theme;
    if (sourcePath === undefined || sourcePath === "") return Promise.resolve(theme);
    const { paths } = this.owner.environment;
    const known =
      paths.findSourceInfoForPath(sourcePath, this.extensionThemeSourceInfos, metadataByPath) ??
      theme.sourceInfo;
    return (
      known === undefined ? paths.getDefaultSourceInfoForPath(sourcePath) : Promise.resolve(known)
    ).then((sourceInfo) => {
      theme.sourceInfo = sourceInfo;
      return theme;
    });
  }

  configure(options: resourceLoaderTypes.DefaultResourceLoaderOptions): void {
    this.additionalThemePaths = options.additionalThemePaths ?? [];
    this.noThemes = options.noThemes ?? false;
    this.themesOverride = options.themesOverride;
  }

  reload(plan: defaultResourceLoaderInternalTypes.ResourcePlan): Promise<void> {
    const { paths } = this.owner.environment;
    const { cli, configured } = plan.themes;
    return (
      this.noThemes
        ? paths.mergePaths(cli, this.additionalThemePaths)
        : paths.mergePaths([...cli, ...configured], this.additionalThemePaths)
    )
      .then((themePaths) => {
        this.lastThemePaths = themePaths;
        return this.updateThemesFromPaths(themePaths, plan.metadataByPath);
      })
      .then(() => paths.missingPaths(this.additionalThemePaths, false))
      .then((missing) => {
        for (const resolved of missing) {
          if (this.themeDiagnostics.some((d) => d.path === resolved)) continue;
          this.themeDiagnostics.push({
            message: "Theme path does not exist",
            path: resolved,
            type: "error",
          });
        }
        return undefined;
      });
  }

  extend(
    entries: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>,
  ): Promise<void> {
    for (const entry of entries) {
      this.extensionThemeSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    if (entries.length === 0) return Promise.resolve();
    const { paths } = this.owner.environment;
    return paths
      .mergePaths(
        this.lastThemePaths,
        entries.map((entry) => entry.path),
      )
      .then((themePaths) => {
        this.lastThemePaths = themePaths;
        return this.updateThemesFromPaths(themePaths, paths.resourceMetadataByPath);
      });
  }
}
