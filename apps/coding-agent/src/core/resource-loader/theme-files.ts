import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../../modes/interactive/theme/theme.ts";
import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type diagnosticsTypes from "../diagnostics.ts";
import directoryEntry from "../directory-entry.ts";
import platformModule from "../platform/index.ts";

const { stat } = platformModule.files;
const { readEntries, resolveEntry } = directoryEntry;
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

type ThemeLoad = {
  themes: themeTypes.Theme[];
  diagnostics: diagnosticsTypes.ResourceDiagnostic[];
};

const warning = (path: string, error: unknown, fallback: string) => ({
  message: error instanceof Error ? error.message : fallback,
  path,
  type: "warning" as const,
});

const loadThemeFromFile = (
  filePath: string,
  colorMode: tuiTypes.TerminalColorMode,
): Promise<ThemeLoad> =>
  loadThemeFromPath(filePath, colorMode).then(
    (theme) => ({ diagnostics: [], themes: [theme] }),
    (error: unknown) => ({
      diagnostics: [warning(filePath, error, "failed to load theme")],
      themes: [],
    }),
  );

const merge = (loads: readonly ThemeLoad[]): ThemeLoad => ({
  diagnostics: loads.flatMap((load) => load.diagnostics),
  themes: loads.flatMap((load) => load.themes),
});

const loadThemesFromDir = (
  dir: string,
  colorMode: tuiTypes.TerminalColorMode,
): Promise<ThemeLoad> =>
  readEntries(dir)
    .then((entries) =>
      Promise.all(
        entries
          .filter((entry) => entry.name.endsWith(".json"))
          .map((entry) => resolveEntry(dir, entry)),
      ),
    )
    .then((resolved) =>
      Promise.all(
        resolved
          .filter((entry) => entry?.isFile === true)
          .map((entry) => loadThemeFromFile(entry!.fullPath, colorMode)),
      ),
    )
    .then(merge, (error: unknown) => ({
      diagnostics: [warning(dir, error, "failed to read theme directory")],
      themes: [],
    }));

const loadThemePath = (
  resolved: string,
  colorMode: tuiTypes.TerminalColorMode,
): Promise<ThemeLoad> =>
  stat(resolved).then(
    (info) => {
      if (info.isDirectory) return loadThemesFromDir(resolved, colorMode);
      if (info.isFile && resolved.endsWith(".json")) return loadThemeFromFile(resolved, colorMode);
      return {
        diagnostics: [
          { message: "theme path is not a json file", path: resolved, type: "warning" as const },
        ],
        themes: [],
      };
    },
    (error: unknown) => ({
      diagnostics: [
        platformModule.isMissingPath(error)
          ? { message: "theme path does not exist", path: resolved, type: "warning" as const }
          : warning(resolved, error, "failed to read theme path"),
      ],
      themes: [],
    }),
  );

const loadThemes = (
  resolvedPaths: string[],
  colorMode: tuiTypes.TerminalColorMode,
): Promise<ThemeLoad> =>
  Promise.all(resolvedPaths.map((resolved) => loadThemePath(resolved, colorMode))).then(merge);

const themeFiles = { dedupeThemes, loadThemes };

export default themeFiles;
