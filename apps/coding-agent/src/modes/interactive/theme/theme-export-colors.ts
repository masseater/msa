import tui from "@msa/tui";

import systemTheme from "./system-theme.ts";
import themeJson from "./theme-json.ts";
import themeLoader from "./theme-loader.ts";
import type themeSchemaTypes from "./theme-schema.types.ts";
import themeState from "./theme-state.ts";

const { colorToHex, indexedColor, parseColor } = tui;
const { SYSTEM_THEME_NAME } = systemTheme;

function selectedThemeName(themeName?: string): string {
  return themeName ?? themeState.selection.currentName ?? SYSTEM_THEME_NAME;
}

function getResolvedThemeColors(themeName?: string): Record<string, string> {
  const { colors } = themeLoader.loadTheme(selectedThemeName(themeName));
  return Object.fromEntries(
    Object.entries(colors).map(([token, color]) => [token, colorToHex(color)]),
  );
}

function isLightTheme(themeName?: string): boolean {
  return themeLoader.loadTheme(selectedThemeName(themeName)).appearance === "light";
}

function exportColorResolver(
  vars: Record<string, themeSchemaTypes.ThemeColorValue>,
): (value: themeSchemaTypes.ThemeColorValue | undefined) => string | undefined {
  return (value) => {
    if (value === undefined) return undefined;
    const resolved = themeJson.resolveVarRefs(value, vars);
    if (typeof resolved === "number") return colorToHex(indexedColor(resolved));
    if (resolved === "") return undefined;
    if (/^okhsl\(/iu.test(resolved)) return colorToHex(parseColor(resolved));
    return resolved;
  };
}

function getThemeExportColors(themeName?: string): {
  pageBg?: string | undefined;
  cardBg?: string | undefined;
  infoBg?: string | undefined;
} {
  const name = selectedThemeName(themeName);
  if (name === SYSTEM_THEME_NAME) return {};
  try {
    const json = themeJson.loadThemeJson(name);
    const exportSection = json.export;
    if (exportSection === undefined) return {};
    const resolve = exportColorResolver(json.vars ?? {});
    return {
      cardBg: resolve(exportSection.cardBg),
      infoBg: resolve(exportSection.infoBg),
      pageBg: resolve(exportSection.pageBg),
    };
  } catch {
    return {};
  }
}

const themeExportColors = {
  getResolvedThemeColors,
  getThemeExportColors,
  isLightTheme,
};

export default themeExportColors;
