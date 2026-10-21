import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../../modes/interactive/theme/theme.ts";
import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type diagnosticsTypes from "../diagnostics.ts";
import platformModule from "../platform/index.ts";
import nodeFs from "../platform/node/fs.ts";

const { existsSync, statSync, readdirSync } = nodeFs;
const { join } = platformModule;
const { loadThemeFromPath } = themeModule;

const dedupeThemes = (
  themes: themeTypes.Theme[],
): {
  themes: themeTypes.Theme[];
  diagnostics: diagnosticsTypes.ResourceDiagnostic[];
} => {
  const seen = new Map<string, themeTypes.Theme>();
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  for (const t of themes) {
    const name = t.name ?? "unnamed";
    const existing = seen.get(name);
    if (existing === undefined) {
      seen.set(name, t);
    } else {
      diagnostics.push({
        collision: {
          loserPath: t.sourcePath ?? "<builtin>",
          name,
          resourceType: "theme",
          winnerPath: existing.sourcePath ?? "<builtin>",
        },
        message: `name "${name}" collision`,
        path: t.sourcePath,
        type: "collision",
      });
    }
  }

  return { diagnostics, themes: Array.from(seen.values()) };
};

const loadThemes = (
  resolvedPaths: string[],
  colorMode: tuiTypes.TerminalColorMode,
): {
  themes: themeTypes.Theme[];
  diagnostics: diagnosticsTypes.ResourceDiagnostic[];
} => {
  const themes: themeTypes.Theme[] = [];
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
  for (const resolved of resolvedPaths) {
    if (!existsSync(resolved)) {
      diagnostics.push({ message: "theme path does not exist", path: resolved, type: "warning" });
      continue;
    }

    try {
      const stats = statSync(resolved);
      if (stats.isDirectory()) {
        loadThemesFromDir(resolved, themes, diagnostics, colorMode);
      } else if (stats.isFile() && resolved.endsWith(".json")) {
        loadThemeFromFile(resolved, themes, diagnostics, colorMode);
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
};

const loadThemesFromDir = (
  dir: string,
  themes: themeTypes.Theme[],
  diagnostics: diagnosticsTypes.ResourceDiagnostic[],
  colorMode: tuiTypes.TerminalColorMode,
): void => {
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
      loadThemeFromFile(join(dir, entry.name), themes, diagnostics, colorMode);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to read theme directory";
    diagnostics.push({ message, path: dir, type: "warning" });
  }
};

const loadThemeFromFile = (
  filePath: string,
  themes: themeTypes.Theme[],
  diagnostics: diagnosticsTypes.ResourceDiagnostic[],
  colorMode: tuiTypes.TerminalColorMode,
): void => {
  try {
    themes.push(loadThemeFromPath(filePath, colorMode));
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load theme";
    diagnostics.push({ message, path: filePath, type: "warning" });
  }
};

const themeFiles = { dedupeThemes, loadThemes };

export default themeFiles;
