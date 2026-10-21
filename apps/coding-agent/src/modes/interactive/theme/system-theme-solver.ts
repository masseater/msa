import type tuiTypes from "@msa/tui/index.types";

import colorContrast from "./color-contrast.ts";
import systemThemeRules from "./system-theme-rules.ts";
import type systemThemeTypes from "./system-theme.types.ts";
import type themeTypes from "./theme.types.ts";

const { oklabLightness } = colorContrast;

interface SolverInput {
  background: tuiTypes.RgbColor;
  lighter: boolean;
  paint: systemThemeTypes.PaintToken;
  target: systemThemeTypes.LightnessTarget;
}

function panelPainter(input: SolverInput): systemThemeTypes.PaintToken {
  const readable = colorContrast.readableAgainstExtreme(input.lighter);
  const backgroundL = oklabLightness(input.background);
  return (token, l) => {
    const color = input.paint(token, l);
    if (readable(color)) return color;
    let [low, high] = [backgroundL, l];
    for (let index = 0; index < 20; index++) {
      const middle = (low + high) / 2;
      if (readable(input.paint(token, middle))) low = middle;
      else high = middle;
    }
    return input.paint(token, low);
  };
}

function tokenTargets(
  token: themeTypes.ThemeToken,
  colors: systemThemeTypes.SolvedColors,
  input: SolverInput,
  relaxation: number,
): number[] | undefined {
  const targets: number[] = [];
  for (const rule of systemThemeRules.rulesFor(token)) {
    for (const surface of rule.on) {
      const surfaceL = oklabLightness(colors.get(surface) ?? input.background);
      const value = input.target(rule.level, surfaceL, relaxation);
      if (value === undefined || value < 0 || value > 1) return undefined;
      targets.push(value);
    }
  }
  return targets;
}

function solveAt(
  input: SolverInput,
  paintPanel: systemThemeTypes.PaintToken,
  relaxation: number,
): systemThemeTypes.SolvedColors | undefined {
  const colors: systemThemeTypes.SolvedColors = new Map([["background", input.background]]);
  for (const token of systemThemeRules.SOLVE_ORDER) {
    const targets = tokenTargets(token, colors, input, relaxation);
    if (targets === undefined) return undefined;
    const l = input.lighter ? Math.max(...targets) : Math.min(...targets);
    colors.set(
      token,
      systemThemeRules.isPanel(token) ? paintPanel(token, l) : input.paint(token, l),
    );
  }
  return colors;
}

function solveSystemColors(input: SolverInput): {
  colors: systemThemeTypes.SolvedColors | undefined;
  relaxation: number;
} {
  const paintPanel = panelPainter(input);
  const strict = solveAt(input, paintPanel, 0);
  if (strict !== undefined) return { colors: strict, relaxation: 0 };
  let [low, high] = [0, 2];
  let colors = solveAt(input, paintPanel, high);
  for (let index = 0; index < 20; index++) {
    const middle = (low + high) / 2;
    const attempt = solveAt(input, paintPanel, middle);
    if (attempt === undefined) {
      low = middle;
    } else {
      [high, colors] = [middle, attempt];
    }
  }
  return { colors, relaxation: high };
}

const systemThemeSolver = {
  solveSystemColors,
};

export default systemThemeSolver;
