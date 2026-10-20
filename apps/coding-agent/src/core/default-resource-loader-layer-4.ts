import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import config from "../config.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import type themeTypes from "../modes/interactive/theme/theme.types.ts";
import DefaultResourceLoaderLayer3 from "./default-resource-loader-layer-3.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";

const { detectCapabilities, getTerminalColorMode } = tui;
const { join } = platformNode;
const { CONFIG_DIR_NAME } = config;
const { existsSync, readdirSync, statSync } = nodeFs;
const { loadThemeFromPath } = themeModule;

export default abstract class DefaultResourceLoaderLayer4 extends DefaultResourceLoaderLayer3 {
  protected updateThemesFromPaths(
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
        ...this.settingsManager.terminal.getTerminalCapabilityOverrides(),
      });
      const loaded = this.loadThemes(themePaths, false, colorMode);
      const deduped = this.dedupeThemes(loaded.themes);
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
          ? (this.findSourceInfoForPath(
              sourcePath,
              this.extensionThemeSourceInfos,
              metadataByPath,
            ) ??
            theme.sourceInfo ??
            this.getDefaultSourceInfoForPath(sourcePath))
          : theme.sourceInfo;
      return theme;
    });
    this.themeDiagnostics = resolvedThemes.diagnostics;
  }

  protected loadThemes(
    paths: string[],
    includeDefaults: boolean,
    colorMode: tuiTypes.TerminalColorMode,
  ): {
    themes: themeTypes.Theme[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  } {
    const themes: themeTypes.Theme[] = [];
    const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
    if (includeDefaults) {
      const defaultDirs = [
        join(this.agentDir, "themes"),
        join(this.cwd, CONFIG_DIR_NAME, "themes"),
      ];

      for (const dir of defaultDirs) {
        this.loadThemesFromDir(dir, themes, diagnostics, colorMode);
      }
    }

    for (const p of paths) {
      const resolved = this.resolveResourcePath(p);
      if (!existsSync(resolved)) {
        diagnostics.push({ message: "theme path does not exist", path: resolved, type: "warning" });
        continue;
      }

      try {
        const stats = statSync(resolved);
        if (stats.isDirectory()) {
          this.loadThemesFromDir(resolved, themes, diagnostics, colorMode);
        } else if (stats.isFile() && resolved.endsWith(".json")) {
          this.loadThemeFromFile(resolved, themes, diagnostics, colorMode);
        } else {
          diagnostics.push({
            message: "theme path is not a json file",
            path: resolved,
            type: "warning",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to read theme path";
        diagnostics.push({ message, path: resolved, type: "warning" });
      }
    }

    return { diagnostics, themes };
  }

  protected loadThemesFromDir(
    dir: string,
    themes: themeTypes.Theme[],
    diagnostics: diagnosticsTypes.ResourceDiagnostic[],
    colorMode: tuiTypes.TerminalColorMode,
  ): void {
    if (!existsSync(dir)) {
      return;
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            isFile = statSync(join(dir, entry.name)).isFile();
          } catch {
            continue;
          }
        }
        if (!isFile) {
          continue;
        }
        if (!entry.name.endsWith(".json")) {
          continue;
        }
        this.loadThemeFromFile(join(dir, entry.name), themes, diagnostics, colorMode);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to read theme directory";
      diagnostics.push({ message, path: dir, type: "warning" });
    }
  }

  protected loadThemeFromFile(
    filePath: string,
    themes: themeTypes.Theme[],
    diagnostics: diagnosticsTypes.ResourceDiagnostic[],
    colorMode: tuiTypes.TerminalColorMode,
  ): void {
    try {
      themes.push(loadThemeFromPath(filePath, colorMode));
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to load theme";
      diagnostics.push({ message, path: filePath, type: "warning" });
    }
  }
}
