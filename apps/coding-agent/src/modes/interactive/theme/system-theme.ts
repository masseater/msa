import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import colorContrast from "./color-contrast.ts";
import systemThemeLevels from "./system-theme-levels.ts";
import systemThemePalette from "./system-theme-palette.ts";
import systemThemeRules from "./system-theme-rules.ts";
import systemThemeShading from "./system-theme-shading.ts";
import systemThemeSolver from "./system-theme-solver.ts";
import type systemThemeTypes from "./system-theme.types.ts";
import type themeTypes from "./theme.types.ts";

const { hexOf, oklabLightness } = colorContrast;
const { THEME_TOKENS } = systemThemePalette;

const SYSTEM_THEME_NAME = "system";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface ForegroundContext {
  foreground: tuiTypes.RgbColor | undefined;
  lighter: boolean;
  relaxation: number;
  saturation: number;
  solved: systemThemeTypes.SolvedColors;
  surfacesOf: (token: themeTypes.ThemeToken) => tuiTypes.RgbColor[];
  target: systemThemeTypes.LightnessTarget;
}

function foregroundTargets(
  context: ForegroundContext,
  surfaces: tuiTypes.RgbColor[],
): number[] | undefined {
  const targets = surfaces.map((surface) =>
    context.target(systemThemeLevels.FOREGROUND_LEVEL, oklabLightness(surface), context.relaxation),
  );
  return targets.every((value) => value !== undefined && value >= 0 && value <= 1)
    ? (targets as number[])
    : undefined;
}

function foregroundTokenColor(
  token: themeTypes.ThemeToken,
  context: ForegroundContext,
): string | undefined {
  const surfaces = context.surfacesOf(token);
  let text = context.solved.get(token);
  const { foreground, lighter } = context;
  const targets = foreground === undefined ? undefined : foregroundTargets(context, surfaces);
  if (foreground !== undefined && targets !== undefined) {
    const needed = lighter ? Math.max(...targets) : Math.min(...targets);
    const foregroundL = oklabLightness(foreground);
    if (lighter ? foregroundL >= needed : foregroundL <= needed) return "";
    text = systemThemeShading.anchored(
      systemThemeShading.sourceOf(foreground),
      systemThemePalette.FAMILIES.neutral,
      tui.oklabToOkhslLightness(needed),
      context.saturation,
    );
  }
  return text === undefined
    ? undefined
    : hexOf(systemThemeShading.withTextContrast(text, surfaces, lighter));
}

function hexColors(
  solved: systemThemeTypes.SolvedColors,
): Record<themeTypes.ThemeToken, string | number> {
  const result = {} as Record<themeTypes.ThemeToken, string | number>;
  for (const token of THEME_TOKENS) {
    const color = solved.get(token);
    result[token] = color === undefined ? "" : hexOf(color);
  }
  return result;
}

function indexedColors(
  saturation: number,
  appearance: themeTypes.ThemeAppearance | undefined,
): systemThemeTypes.SystemThemeColors {
  const colors = {} as Record<themeTypes.ThemeToken, string | number>;
  const dim: themeTypes.ThemeColor[] = [];
  for (const token of THEME_TOKENS) {
    if (systemThemeRules.isPanel(token)) {
      colors[token] = "";
      continue;
    }
    const neutral = systemThemePalette.isNeutralToken(token);
    colors[token] = !neutral && saturation > 0 ? systemThemePalette.paletteSlotOf(token) : "";
    if (neutral && !systemThemeRules.isForegroundToken(token)) {
      dim.push(token as themeTypes.ThemeColor);
    }
  }
  return { appearance, colors, dim };
}

function generateSystemThemeColors(
  input: systemThemeTypes.SystemThemeInput,
): systemThemeTypes.SystemThemeColors {
  const saturation = clamp(input.saturation ?? 1, 0, 1);
  const { background, foreground } = input;
  if (background === undefined) return indexedColors(saturation, input.appearanceHint);
  const appearance = colorContrast.terminalAppearance(background, foreground);
  const lighter = appearance === "dark";
  const palette =
    input.palette?.length === 16 ? input.palette.map(systemThemeShading.sourceOf) : undefined;
  const target = systemThemeLevels.lightnessTarget(appearance);
  const paint = systemThemeShading.paintToken(palette, saturation);
  const { colors, relaxation } = systemThemeSolver.solveSystemColors({
    background,
    lighter,
    paint,
    target,
  });
  const solved: systemThemeTypes.SolvedColors = colors ?? new Map();
  const surfacesOf = (token: themeTypes.ThemeToken) =>
    systemThemeRules
      .rulesFor(token)
      .flatMap((rule) => rule.on.map((surface) => solved.get(surface) ?? background));
  const result = hexColors(solved);
  const context = { foreground, lighter, relaxation, saturation, solved, surfacesOf, target };
  for (const token of systemThemeRules.FOREGROUND_TOKENS) {
    const color = foregroundTokenColor(token, context);
    if (color !== undefined) result[token] = color;
  }
  return { appearance, colors: result, dim: [] };
}

const systemTheme = {
  SYSTEM_THEME_NAME,
  generateSystemThemeColors,
  relativeLuminance: colorContrast.relativeLuminance,
  terminalAppearance: colorContrast.terminalAppearance,
  wcagContrast: colorContrast.wcagContrast,
};

export default systemTheme;
