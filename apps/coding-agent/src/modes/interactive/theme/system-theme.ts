import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import type { TerminalTheme, ThemeAppearance, ThemeBg, ThemeColor, ThemeToken } from "./theme.ts";

const {
  colorToOkhsl,
  colorToOklch,
  colorToRgb,
  okhslColor,
  oklabToOkhslLightness,
  oklchColor,
  rgbColor,
} = tui;

export const SYSTEM_THEME_NAME = "system";

interface Family {
  hue: number;
  saturation: { min: number; max: number };
  slot: number;
}

const FAMILIES = {
  blue: { hue: 231.49, saturation: { max: 0.68, min: 0.1 }, slot: 4 },
  calamine: { hue: 202.43, saturation: { max: 0.74, min: 0.1 }, slot: 6 },
  green: { hue: 158.68, saturation: { max: 0.76, min: 0.1 }, slot: 2 },
  neutral: { hue: 231.49, saturation: { max: 0.08, min: 0.02 }, slot: 8 },
  orange: { hue: 52, saturation: { max: 0.85, min: 0.12 }, slot: 3 },
  red: { hue: 20, saturation: { max: 0.92, min: 0.1 }, slot: 1 },
  thinkingBlue: { hue: 231.49, saturation: { max: 0.45, min: 0.2 }, slot: 4 },
  thinkingMagenta: { hue: 337.5, saturation: { max: 0.85, min: 0.5 }, slot: 13 },
  thinkingPeriwinkle: { hue: 263.25, saturation: { max: 0.6, min: 0.3 }, slot: 6 },
  thinkingRed: { hue: 20, saturation: { max: 1, min: 0.95 }, slot: 1 },
  thinkingSlate: { hue: 231.49, saturation: { max: 0.2, min: 0.08 }, slot: 4 },
  thinkingViolet: { hue: 295, saturation: { max: 0.75, min: 0.4 }, slot: 5 },
  violet: { hue: 295, saturation: { max: 0.6, min: 0.2 }, slot: 5 },
  yellow: { hue: 82.36, saturation: { max: 1, min: 0.5 }, slot: 3 },
} satisfies Record<string, Family>;

type FamilyName = keyof typeof FAMILIES;

const TOKEN_FAMILIES: Record<ThemeToken, FamilyName> = {
  accent: "violet",
  bashMode: "green",
  border: "blue",
  borderAccent: "violet",
  borderMuted: "neutral",
  customMessageBg: "violet",
  customMessageLabel: "violet",
  customMessageText: "neutral",
  dim: "neutral",
  error: "red",
  mdCode: "violet",
  mdCodeBlock: "green",
  mdCodeBlockBorder: "neutral",
  mdHeading: "yellow",
  mdHr: "neutral",
  mdLink: "blue",
  mdLinkUrl: "neutral",
  mdListBullet: "violet",
  mdQuote: "neutral",
  mdQuoteBorder: "neutral",
  muted: "neutral",
  scrollbarThumb: "neutral",
  scrollbarTrack: "neutral",
  searchMatchBg: "orange",
  searchMatchText: "neutral",
  selectedBg: "blue",
  success: "green",
  syntaxComment: "neutral",
  syntaxFunction: "yellow",
  syntaxKeyword: "blue",
  syntaxNumber: "green",
  syntaxOperator: "neutral",
  syntaxPunctuation: "neutral",
  syntaxString: "orange",
  syntaxType: "violet",
  syntaxVariable: "calamine",
  text: "neutral",
  thinkingHigh: "thinkingViolet",
  thinkingLow: "thinkingBlue",
  thinkingMax: "thinkingRed",
  thinkingMedium: "thinkingPeriwinkle",
  thinkingMinimal: "thinkingSlate",
  thinkingOff: "neutral",
  thinkingText: "neutral",
  thinkingXhigh: "thinkingMagenta",
  toolDiffAdded: "green",
  toolDiffContext: "neutral",
  toolDiffRemoved: "red",
  toolErrorBg: "red",
  toolOutput: "neutral",
  toolPendingBg: "neutral",
  toolSuccessBg: "green",
  toolTitle: "neutral",
  userMessageBg: "blue",
  userMessageText: "neutral",
  warning: "yellow",
};

const TOKEN_SLOTS: Partial<Record<ThemeToken, number>> = {
  searchMatchBg: 3,
  syntaxNumber: 5,
  syntaxString: 2,
};

interface Curve {
  coefficients: number[];
  reachable: [number, number];
}

const LEVELS = {
  emphasis: {
    dark: {
      coefficients: [0.7303, 0.07695, -1.31626, 7.1681, -10.14436, 4.92846],
      reachable: [0, 0.712],
    },
    light: {
      coefficients: [-4948.31942, 26870.91986, -58334.48399, 63280.17197, -34298.01053, 7430.30146],
      reachable: [0.811, 1],
    },
  },
  panel: {
    dark: {
      coefficients: [0.29131, -0.39746, 2.33185, -0.85524, -1.2076, 0.86276],
      reachable: [0, 0.979],
    },
    light: {
      coefficients: [-3.74073, 27.94549, -78.44258, 112.6798, -79.60015, 22.11277],
      reachable: [0.348, 1],
    },
  },
  readable: {
    dark: {
      coefficients: [0.66937, 0.04704, -1.06871, 6.43941, -8.9332, 4.17229],
      reachable: [0, 0.77],
    },
    light: {
      coefficients: [-1554.52576, 8733.56817, -19604.93507, 21977.72696, -12300.99599, 2749.81288],
      reachable: [0.751, 1],
    },
  },
  subtle: {
    dark: {
      coefficients: [0.56762, -0.02475, -0.5383, 5.12628, -7.10931, 3.17324],
      reachable: [0, 0.848],
    },
    light: {
      coefficients: [-232.85459, 1376.54473, -3249.11801, 3827.91186, -2248.29472, 526.55751],
      reachable: [0.657, 1],
    },
  },
  text: {
    dark: {
      coefficients: [0.89242, 0.02311, -0.44862, 2.34417, -0.06084, -2.63844],
      reachable: [0, 0.5],
    },
    light: {
      coefficients: [-2004.67048, 6664.47299, -6060.70202, -1792.61209, 5133.82359, -1939.85583],
      reachable: [0.894, 1],
    },
  },
  textOnPanel: {
    dark: {
      coefficients: [0.86713, 0.05232, -0.89428, 4.79014, -5.5432, 1.75023],
      reachable: [0, 0.542],
    },
    light: {
      coefficients: [-8570.89457, 43954.60805, -90084.00702, 92220.6791, -47152.15802, 9632.27113],
      reachable: [0.867, 1],
    },
  },
  thinking0: {
    dark: {
      coefficients: [0.52988, -0.05809, -0.30924, 4.63567, -6.52933, 2.89108],
      reachable: [0, 0.873],
    },
    light: {
      coefficients: [-28.27749, 182.85284, -469.62416, 603.15916, -384.59976, 97.35147],
      reachable: [0.51, 1],
    },
  },
  thinking1: {
    dark: {
      coefficients: [0.55278, -0.03667, -0.45659, 4.95347, -6.90265, 3.0706],
      reachable: [0, 0.858],
    },
    light: {
      coefficients: [-37.10484, 235.86282, -596.62344, 754.3633, -474.00763, 118.3551],
      reachable: [0.535, 1],
    },
  },
  thinking2: {
    dark: {
      coefficients: [0.57486, -0.01765, -0.58987, 5.25227, -7.27175, 3.25532],
      reachable: [0, 0.842],
    },
    light: {
      coefficients: [-59.89653, 377.05024, -945.07843, 1182.03145, -734.96375, 181.68658],
      reachable: [0.556, 1],
    },
  },
  thinking3: {
    dark: {
      coefficients: [0.59621, -0.00062, -0.71148, 5.53588, -7.6392, 3.44606],
      reachable: [0, 0.827],
    },
    light: {
      coefficients: [-72.07122, 445.84082, -1099.57352, 1353.88793, -829.53392, 202.26164],
      reachable: [0.58, 1],
    },
  },
  thinking4: {
    dark: {
      coefficients: [0.61691, 0.01462, -0.82288, 5.80651, -8.00641, 3.64333],
      reachable: [0, 0.811],
    },
    light: {
      coefficients: [-110.14338, 674.21488, -1645.75941, 2004.32367, -1215.15899, 293.3183],
      reachable: [0.6, 1],
    },
  },
  thinking5: {
    dark: {
      coefficients: [0.63702, 0.02826, -0.92498, 6.06465, -8.37246, 3.84651],
      reachable: [0, 0.795],
    },
    light: {
      coefficients: [-175.47701, 1063.54495, -2570.70594, 3098.80776, -1860.15527, 444.76392],
      reachable: [0.62, 1],
    },
  },
  thinking6: {
    dark: {
      coefficients: [0.65658, 0.04044, -1.01835, 6.30989, -8.73529, 4.05439],
      reachable: [0, 0.779],
    },
    light: {
      coefficients: [-183.81712, 1094.70055, -2602.68539, 3088.71276, -1826.91131, 430.75931],
      reachable: [0.643, 1],
    },
  },
  thumb: {
    dark: {
      coefficients: [0.60323, 0.00278, -0.73328, 5.57157, -7.68067, 3.46933],
      reachable: [0, 0.823],
    },
    light: {
      coefficients: [-82.89897, 511.01355, -1255.98095, 1540.76821, -940.68087, 228.58523],
      reachable: [0.586, 1],
    },
  },
  track: {
    dark: {
      coefficients: [0.39028, -0.23015, 0.83573, 2.43829, -4.38292, 2.01582],
      reachable: [0, 0.946],
    },
    light: {
      coefficients: [-5.24921, 38.37322, -107.28833, 152.10005, -106.17127, 29.18061],
      reachable: [0.368, 1],
    },
  },
} satisfies Record<string, Record<ThemeAppearance, Curve>>;

type Level = keyof typeof LEVELS;

type Surface = ThemeBg | "background" | "scrollbarTrack";

interface Rule {
  token: ThemeToken;
  on: Surface[];
  level: Level;
}

const TOOL_PANELS: Surface[] = ["toolPendingBg", "toolSuccessBg", "toolErrorBg"];
const MESSAGE_PANELS: Surface[] = ["userMessageBg", "customMessageBg"];
const PANELS: ThemeBg[] = [
  "userMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "selectedBg",
  "searchMatchBg",
  "customMessageBg",
];
const THINKING: [ThemeColor, Level][] = [
  ["thinkingOff", "thinking0"],
  ["thinkingMinimal", "thinking1"],
  ["thinkingLow", "thinking2"],
  ["thinkingMedium", "thinking3"],
  ["thinkingHigh", "thinking4"],
  ["thinkingXhigh", "thinking5"],
  ["thinkingMax", "thinking6"],
];

const each = (tokens: ThemeToken[], on: Surface[], level: Level): Rule[] =>
  tokens.map((token) => ({ level, on, token }));

const RULES: Rule[] = [
  ...each(PANELS, ["background"], "panel"),
  { level: "text", on: ["background"], token: "text" },
  { level: "textOnPanel", on: ["selectedBg"], token: "text" },
  { level: "textOnPanel", on: ["userMessageBg"], token: "userMessageText" },
  { level: "textOnPanel", on: TOOL_PANELS, token: "toolTitle" },
  ...each(
    ["accent", "success", "error", "warning"],
    ["background", "selectedBg", ...TOOL_PANELS],
    "readable",
  ),
  {
    level: "readable",
    on: ["background", "selectedBg", "customMessageBg", ...TOOL_PANELS],
    token: "muted",
  },
  {
    level: "subtle",
    on: ["background", "selectedBg", "customMessageBg", ...TOOL_PANELS],
    token: "dim",
  },
  { level: "readable", on: ["background"], token: "thinkingText" },
  { level: "readable", on: ["customMessageBg", ...TOOL_PANELS], token: "customMessageText" },
  {
    level: "readable",
    on: ["background", "customMessageBg", "selectedBg", ...TOOL_PANELS],
    token: "customMessageLabel",
  },
  { level: "readable", on: ["background", ...TOOL_PANELS], token: "toolOutput" },
  ...each(
    ["mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdQuote", "mdCodeBlockBorder", "mdListBullet"],
    ["background", ...MESSAGE_PANELS],
    "readable",
  ),
  {
    level: "readable",
    on: ["background", ...MESSAGE_PANELS, ...TOOL_PANELS],
    token: "mdCodeBlock",
  },
  ...each(
    ["toolDiffAdded", "toolDiffRemoved", "toolDiffContext"],
    ["background", ...TOOL_PANELS],
    "readable",
  ),
  ...each(
    [
      "syntaxComment",
      "syntaxKeyword",
      "syntaxFunction",
      "syntaxVariable",
      "syntaxString",
      "syntaxNumber",
      "syntaxType",
      "syntaxOperator",
      "syntaxPunctuation",
    ],
    ["background", ...MESSAGE_PANELS, ...TOOL_PANELS],
    "readable",
  ),
  { level: "readable", on: ["searchMatchBg"], token: "searchMatchText" },
  ...each(["bashMode", "border", "borderAccent"], ["background"], "readable"),
  { level: "subtle", on: ["background"], token: "borderMuted" },
  ...each(["mdQuoteBorder", "mdHr"], ["background", ...MESSAGE_PANELS, ...TOOL_PANELS], "readable"),
  { level: "track", on: ["background"], token: "scrollbarTrack" },
  { level: "thumb", on: ["scrollbarTrack"], token: "scrollbarThumb" },
  ...THINKING.map(([token, level]): Rule => ({
    level,
    on: ["background"],
    token,
  })),
];

const READABLE_FLOOR: Record<ThemeAppearance, Level> = { dark: "readable", light: "subtle" };

const FOREGROUND_LEVEL: Level = "emphasis";

const FOREGROUND_TOKENS: ThemeColor[] = ["text", "userMessageText", "toolTitle"];

const TEXT_MINIMUM_WCAG_CONTRAST = 4.5;

const SOLVE_ORDER: ThemeToken[] = (() => {
  const order: ThemeToken[] = [];
  const visit = (token: ThemeToken): void => {
    if (order.includes(token)) return;
    for (const rule of RULES) {
      if (rule.token !== token) continue;
      for (const surface of rule.on) if (surface !== "background") visit(surface);
    }
    order.push(token);
  };
  for (const rule of RULES) visit(rule.token);
  return order;
})();

export interface SystemThemeInput {
  foreground?: tuiTypes.RgbColor | undefined;
  background?: tuiTypes.RgbColor | undefined;
  palette?: tuiTypes.RgbColor[] | undefined;
  saturation?: number;
  appearanceHint?: ThemeAppearance;
}

export interface SystemThemeColors {
  colors: Record<ThemeToken, string | number>;
  dim: ThemeColor[];
  appearance: ThemeAppearance | undefined;
}

function oklabLightness(color: tuiTypes.RgbColor): number {
  return colorToOklch(rgbColor(color.r, color.g, color.b)).l;
}

export function relativeLuminance({ r, g, b }: tuiTypes.RgbColor): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export const wcagContrast: {
  (second: tuiTypes.RgbColor): (first: tuiTypes.RgbColor) => number;
  (first: tuiTypes.RgbColor, second: tuiTypes.RgbColor): number;
} = dual(2, (first: tuiTypes.RgbColor, second: tuiTypes.RgbColor): number => {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
});

export const terminalAppearance: {
  (foreground: tuiTypes.RgbColor | undefined): (background: tuiTypes.RgbColor) => ThemeAppearance;
  (background: tuiTypes.RgbColor, foreground: tuiTypes.RgbColor | undefined): ThemeAppearance;
} = dual(
  2,
  (background: tuiTypes.RgbColor, foreground: tuiTypes.RgbColor | undefined): ThemeAppearance => {
    const white = { b: 255, g: 255, r: 255 };
    const black = { b: 0, g: 0, r: 0 };
    const whiteContrast = wcagContrast(white, background);
    const blackContrast = wcagContrast(black, background);
    if (foreground !== undefined) {
      const foregroundL = oklabLightness(foreground);
      const backgroundL = oklabLightness(background);
      if (Math.abs(foregroundL - backgroundL) > 0.05) {
        const appearance = foregroundL > backgroundL ? "dark" : "light";
        const best = appearance === "dark" ? whiteContrast : blackContrast;
        if (best >= TEXT_MINIMUM_WCAG_CONTRAST) return appearance;
      }
    }
    return whiteContrast >= blackContrast ? "dark" : "light";
  },
);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function hexOf({ r, g, b }: tuiTypes.RgbColor): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function bellWeight(lightness: number): number {
  const gaussian = (x: number): number => Math.exp(-((x - 0.5) ** 2) / (2 * 0.25 ** 2));
  return (gaussian(lightness) - gaussian(0)) / (1 - gaussian(0));
}

function saturationCurve({ saturation: { min, max } }: Family, lightness: number): number {
  const floor = max > 0 ? min / max : 1;
  return floor + (1 - floor) * bellWeight(lightness);
}

function levelTarget(
  level: Level,
  appearance: ThemeAppearance,
  surfaceL: number,
): number | undefined {
  const curve: Curve = LEVELS[level][appearance];
  if (surfaceL < curve.reachable[0] || surfaceL > curve.reachable[1]) return undefined;
  return curve.coefficients.reduce(
    (sum, coefficient, power) => sum + coefficient * surfaceL ** power,
    0,
  );
}

export function generateSystemThemeColors(input: SystemThemeInput): SystemThemeColors {
  const saturation = clamp(input.saturation ?? 1, 0, 1);
  const { background, foreground } = input;
  if (background === undefined) return indexedColors(saturation, input.appearanceHint);
  let { surfacesOf, solved, target, relaxation, lighter, result, appearance } =
    generateSystemThemeColorsSurfacesOf2(input, background, foreground, saturation);

  for (const token of FOREGROUND_TOKENS) {
    const surfaces = surfacesOf(token);
    let text = solved.get(token);
    if (foreground !== undefined) {
      const targets = surfaces.map((surface) =>
        target(FOREGROUND_LEVEL, oklabLightness(surface), relaxation),
      );
      if (targets.every((value) => value !== undefined && value >= 0 && value <= 1)) {
        const needed = lighter
          ? Math.max(...(targets as number[]))
          : Math.min(...(targets as number[]));
        const foregroundL = oklabLightness(foreground);
        if (lighter ? foregroundL >= needed : foregroundL <= needed) {
          result[token] = "";
          continue;
        }
        text = anchored(
          sourceOf(foreground),
          FAMILIES.neutral,
          oklabToOkhslLightness(needed),
          saturation,
        );
      }
    }
    if (text !== undefined) result[token] = hexOf(withTextContrast(text, surfaces, lighter));
  }
  return { appearance, colors: result, dim: [] };
}

function generateSystemThemeColorsSurfacesOf2(
  input: SystemThemeInput,
  background: tuiTypes.RgbColor,
  foreground: tuiTypes.RgbColor | undefined,
  saturation: number,
): {
  surfacesOf: (token: ThemeToken) => tuiTypes.RgbColor[];
  solved: Map<
    | "accent"
    | "border"
    | "borderAccent"
    | "borderMuted"
    | "success"
    | "error"
    | "warning"
    | "muted"
    | "dim"
    | "text"
    | "thinkingText"
    | "scrollbarThumb"
    | "searchMatchText"
    | "userMessageText"
    | "customMessageText"
    | "customMessageLabel"
    | "toolTitle"
    | "toolOutput"
    | "mdHeading"
    | "mdLink"
    | "mdLinkUrl"
    | "mdCode"
    | "mdCodeBlock"
    | "mdCodeBlockBorder"
    | "mdQuote"
    | "mdQuoteBorder"
    | "mdHr"
    | "mdListBullet"
    | "toolDiffAdded"
    | "toolDiffRemoved"
    | "toolDiffContext"
    | "syntaxComment"
    | "syntaxKeyword"
    | "syntaxFunction"
    | "syntaxVariable"
    | "syntaxString"
    | "syntaxNumber"
    | "syntaxType"
    | "syntaxOperator"
    | "syntaxPunctuation"
    | "thinkingOff"
    | "thinkingMinimal"
    | "thinkingLow"
    | "thinkingMedium"
    | "thinkingHigh"
    | "thinkingXhigh"
    | "thinkingMax"
    | "bashMode"
    | Surface,
    tuiTypes.RgbColor
  >;
  target: (level: Level, surfaceL: number, t: number) => number | undefined;
  relaxation: number;
  lighter: boolean;
  result: Record<
    | "accent"
    | "border"
    | "borderAccent"
    | "borderMuted"
    | "success"
    | "error"
    | "warning"
    | "muted"
    | "dim"
    | "text"
    | "thinkingText"
    | "scrollbarTrack"
    | "scrollbarThumb"
    | "selectedBg"
    | "searchMatchBg"
    | "searchMatchText"
    | "userMessageBg"
    | "userMessageText"
    | "customMessageBg"
    | "customMessageText"
    | "customMessageLabel"
    | "toolPendingBg"
    | "toolSuccessBg"
    | "toolErrorBg"
    | "toolTitle"
    | "toolOutput"
    | "mdHeading"
    | "mdLink"
    | "mdLinkUrl"
    | "mdCode"
    | "mdCodeBlock"
    | "mdCodeBlockBorder"
    | "mdQuote"
    | "mdQuoteBorder"
    | "mdHr"
    | "mdListBullet"
    | "toolDiffAdded"
    | "toolDiffRemoved"
    | "toolDiffContext"
    | "syntaxComment"
    | "syntaxKeyword"
    | "syntaxFunction"
    | "syntaxVariable"
    | "syntaxString"
    | "syntaxNumber"
    | "syntaxType"
    | "syntaxOperator"
    | "syntaxPunctuation"
    | "thinkingOff"
    | "thinkingMinimal"
    | "thinkingLow"
    | "thinkingMedium"
    | "thinkingHigh"
    | "thinkingXhigh"
    | "thinkingMax"
    | "bashMode",
    string | number
  >;
  appearance: TerminalTheme;
} {
  const { paint, readable, backgroundL, target, lighter, appearance } =
    generateSystemThemeColorsPaint(input, background, foreground, saturation);
  let { colors, solve, relaxation } = generateSystemThemeColorsColors(
    paint,
    readable,
    backgroundL,
    background,
    target,
    lighter,
  );
  if (colors === undefined) {
    let [low, high] = [0, 2];
    colors = solve(high);
    for (let index = 0; index < 20; index++) {
      const middle = (low + high) / 2;
      const attempt = solve(middle);
      if (attempt === undefined) {
        low = middle;
      } else {
        [high, colors] = [middle, attempt];
      }
    }
    relaxation = high;
  }
  const { surfacesOf, solved, result } = generateSystemThemeColorsSurfacesOf(colors, background);
  return { appearance, lighter, relaxation, result, solved, surfacesOf, target };
}

function generateSystemThemeColorsPaint(
  input: SystemThemeInput,
  background: tuiTypes.RgbColor,
  foreground: tuiTypes.RgbColor | undefined,
  saturation: number,
): {
  paint: (token: ThemeToken, oklabL: number) => tuiTypes.RgbColor;
  readable: (color: tuiTypes.RgbColor) => boolean;
  backgroundL: number;
  target: (level: Level, surfaceL: number, t: number) => number | undefined;
  lighter: boolean;
  appearance: TerminalTheme;
} {
  const palette = input.palette?.length === 16 ? input.palette.map(sourceOf) : undefined;

  const appearance = terminalAppearance(background, foreground);
  const lighter = appearance === "dark";
  const extreme = lighter ? 1 : 0;
  const backgroundL = oklabLightness(background);

  const paint = (token: ThemeToken, oklabL: number): tuiTypes.RgbColor => {
    const lightness = oklabToOkhslLightness(oklabL);
    const family: Family = FAMILIES[TOKEN_FAMILIES[token]];
    const source = palette?.[TOKEN_SLOTS[token] ?? family.slot];
    if (source === undefined) {
      const { min, max } = family.saturation;
      return okhslColor(
        family.hue,
        (min + (max - min) * bellWeight(lightness)) * saturation,
        lightness,
      );
    }
    return anchored(source, family, lightness, saturation);
  };

  const target = (level: Level, surfaceL: number, t: number): number | undefined => {
    const reached = levelTarget(level, appearance, surfaceL);
    if (reached === undefined && t === 0) return undefined;
    const distance = (reached ?? extreme) - surfaceL;
    const floor =
      (levelTarget(READABLE_FLOOR[appearance], appearance, surfaceL) ?? extreme) - surfaceL;
    const compressed =
      Math.abs(distance) > Math.abs(floor)
        ? distance - (distance - floor) * Math.min(t, 1)
        : distance;
    return surfaceL + compressed * (1 - Math.max(0, t - 1));
  };

  const extremeText = lighter ? { b: 255, g: 255, r: 255 } : { b: 0, g: 0, r: 0 };
  const readable = (color: tuiTypes.RgbColor) =>
    wcagContrast(extremeText, color) >= TEXT_MINIMUM_WCAG_CONTRAST;
  return { appearance, backgroundL, lighter, paint, readable, target };
}

function generateSystemThemeColorsColors(
  paint: (token: ThemeToken, oklabL: number) => tuiTypes.RgbColor,
  readable: (color: tuiTypes.RgbColor) => boolean,
  backgroundL: number,
  background: tuiTypes.RgbColor,
  target: (level: Level, surfaceL: number, t: number) => number | undefined,
  lighter: boolean,
): {
  colors:
    | Map<
        | "accent"
        | "border"
        | "borderAccent"
        | "borderMuted"
        | "success"
        | "error"
        | "warning"
        | "muted"
        | "dim"
        | "text"
        | "thinkingText"
        | "scrollbarThumb"
        | "searchMatchText"
        | "userMessageText"
        | "customMessageText"
        | "customMessageLabel"
        | "toolTitle"
        | "toolOutput"
        | "mdHeading"
        | "mdLink"
        | "mdLinkUrl"
        | "mdCode"
        | "mdCodeBlock"
        | "mdCodeBlockBorder"
        | "mdQuote"
        | "mdQuoteBorder"
        | "mdHr"
        | "mdListBullet"
        | "toolDiffAdded"
        | "toolDiffRemoved"
        | "toolDiffContext"
        | "syntaxComment"
        | "syntaxKeyword"
        | "syntaxFunction"
        | "syntaxVariable"
        | "syntaxString"
        | "syntaxNumber"
        | "syntaxType"
        | "syntaxOperator"
        | "syntaxPunctuation"
        | "thinkingOff"
        | "thinkingMinimal"
        | "thinkingLow"
        | "thinkingMedium"
        | "thinkingHigh"
        | "thinkingXhigh"
        | "thinkingMax"
        | "bashMode"
        | Surface,
        tuiTypes.RgbColor
      >
    | undefined;
  solve: (t: number) => Map<Surface | ThemeToken, tuiTypes.RgbColor> | undefined;
  relaxation: number;
} {
  const limitPanel = (token: ThemeToken, l: number): tuiTypes.RgbColor => {
    const color = paint(token, l);
    if (readable(color)) return color;
    let [low, high] = [backgroundL, l];
    for (let index = 0; index < 20; index++) {
      const middle = (low + high) / 2;
      if (readable(paint(token, middle))) low = middle;
      else high = middle;
    }
    return paint(token, low);
  };

  const solve = (t: number): Map<Surface | ThemeToken, tuiTypes.RgbColor> | undefined => {
    const colors = new Map<Surface | ThemeToken, tuiTypes.RgbColor>([["background", background]]);
    for (const token of SOLVE_ORDER) {
      const targets: number[] = [];
      for (const rule of RULES) {
        if (rule.token !== token) continue;
        for (const surface of rule.on) {
          const value = target(rule.level, oklabLightness(colors.get(surface) ?? background), t);
          if (value === undefined || value < 0 || value > 1) return undefined;
          targets.push(value);
        }
      }
      const l = lighter ? Math.max(...targets) : Math.min(...targets);
      colors.set(token, PANELS.includes(token as ThemeBg) ? limitPanel(token, l) : paint(token, l));
    }
    return colors;
  };

  let relaxation = 0;
  let colors = solve(0);
  return { colors, relaxation, solve };
}

function generateSystemThemeColorsSurfacesOf(
  colors:
    | Map<
        | "accent"
        | "border"
        | "borderAccent"
        | "borderMuted"
        | "success"
        | "error"
        | "warning"
        | "muted"
        | "dim"
        | "text"
        | "thinkingText"
        | "scrollbarThumb"
        | "searchMatchText"
        | "userMessageText"
        | "customMessageText"
        | "customMessageLabel"
        | "toolTitle"
        | "toolOutput"
        | "mdHeading"
        | "mdLink"
        | "mdLinkUrl"
        | "mdCode"
        | "mdCodeBlock"
        | "mdCodeBlockBorder"
        | "mdQuote"
        | "mdQuoteBorder"
        | "mdHr"
        | "mdListBullet"
        | "toolDiffAdded"
        | "toolDiffRemoved"
        | "toolDiffContext"
        | "syntaxComment"
        | "syntaxKeyword"
        | "syntaxFunction"
        | "syntaxVariable"
        | "syntaxString"
        | "syntaxNumber"
        | "syntaxType"
        | "syntaxOperator"
        | "syntaxPunctuation"
        | "thinkingOff"
        | "thinkingMinimal"
        | "thinkingLow"
        | "thinkingMedium"
        | "thinkingHigh"
        | "thinkingXhigh"
        | "thinkingMax"
        | "bashMode"
        | Surface,
        tuiTypes.RgbColor
      >
    | undefined,
  background: tuiTypes.RgbColor,
): {
  surfacesOf: (token: ThemeToken) => tuiTypes.RgbColor[];
  solved: Map<
    | "accent"
    | "border"
    | "borderAccent"
    | "borderMuted"
    | "success"
    | "error"
    | "warning"
    | "muted"
    | "dim"
    | "text"
    | "thinkingText"
    | "scrollbarThumb"
    | "searchMatchText"
    | "userMessageText"
    | "customMessageText"
    | "customMessageLabel"
    | "toolTitle"
    | "toolOutput"
    | "mdHeading"
    | "mdLink"
    | "mdLinkUrl"
    | "mdCode"
    | "mdCodeBlock"
    | "mdCodeBlockBorder"
    | "mdQuote"
    | "mdQuoteBorder"
    | "mdHr"
    | "mdListBullet"
    | "toolDiffAdded"
    | "toolDiffRemoved"
    | "toolDiffContext"
    | "syntaxComment"
    | "syntaxKeyword"
    | "syntaxFunction"
    | "syntaxVariable"
    | "syntaxString"
    | "syntaxNumber"
    | "syntaxType"
    | "syntaxOperator"
    | "syntaxPunctuation"
    | "thinkingOff"
    | "thinkingMinimal"
    | "thinkingLow"
    | "thinkingMedium"
    | "thinkingHigh"
    | "thinkingXhigh"
    | "thinkingMax"
    | "bashMode"
    | Surface,
    tuiTypes.RgbColor
  >;
  result: Record<
    | "accent"
    | "border"
    | "borderAccent"
    | "borderMuted"
    | "success"
    | "error"
    | "warning"
    | "muted"
    | "dim"
    | "text"
    | "thinkingText"
    | "scrollbarTrack"
    | "scrollbarThumb"
    | "selectedBg"
    | "searchMatchBg"
    | "searchMatchText"
    | "userMessageBg"
    | "userMessageText"
    | "customMessageBg"
    | "customMessageText"
    | "customMessageLabel"
    | "toolPendingBg"
    | "toolSuccessBg"
    | "toolErrorBg"
    | "toolTitle"
    | "toolOutput"
    | "mdHeading"
    | "mdLink"
    | "mdLinkUrl"
    | "mdCode"
    | "mdCodeBlock"
    | "mdCodeBlockBorder"
    | "mdQuote"
    | "mdQuoteBorder"
    | "mdHr"
    | "mdListBullet"
    | "toolDiffAdded"
    | "toolDiffRemoved"
    | "toolDiffContext"
    | "syntaxComment"
    | "syntaxKeyword"
    | "syntaxFunction"
    | "syntaxVariable"
    | "syntaxString"
    | "syntaxNumber"
    | "syntaxType"
    | "syntaxOperator"
    | "syntaxPunctuation"
    | "thinkingOff"
    | "thinkingMinimal"
    | "thinkingLow"
    | "thinkingMedium"
    | "thinkingHigh"
    | "thinkingXhigh"
    | "thinkingMax"
    | "bashMode",
    string | number
  >;
} {
  const solved = colors ?? new Map<Surface | ThemeToken, tuiTypes.RgbColor>();
  const surfacesOf = (token: ThemeToken) =>
    RULES.filter((rule) => rule.token === token).flatMap((rule) =>
      rule.on.map((surface) => solved.get(surface) ?? background),
    );

  const result = {} as Record<ThemeToken, string | number>;
  for (const token of Object.keys(TOKEN_FAMILIES) as ThemeToken[]) {
    const color = solved.get(token);
    result[token] = color === undefined ? "" : hexOf(color);
  }
  return { result, solved, surfacesOf };
}

function okhslOf({ r, g, b }: tuiTypes.RgbColor): tuiTypes.OkhslChannels {
  return colorToOkhsl(rgbColor(r, g, b));
}

interface SourceColor extends tuiTypes.OkhslChannels {
  chroma: number;
}

function sourceOf(color: tuiTypes.RgbColor): SourceColor {
  return { ...okhslOf(color), chroma: colorToOklch(rgbColor(color.r, color.g, color.b)).c };
}

function anchored(
  source: SourceColor,
  family: Family,
  lightness: number,
  saturation: number,
): tuiTypes.RgbColor {
  const anchor = saturationCurve(family, source.l);
  const falloff = anchor > 0 ? Math.min(1, saturationCurve(family, lightness) / anchor) : 1;
  const color = okhslColor(source.h, source.s * falloff * saturation, lightness);
  const cap = source.chroma * falloff * saturation;
  const { l, c } = colorToOklch(color);
  return c <= cap ? color : colorToRgb(oklchColor(l, cap, source.h));
}

function withTextContrast(
  color: tuiTypes.RgbColor,
  surfaces: tuiTypes.RgbColor[],
  lighter: boolean,
): tuiTypes.RgbColor {
  const meets = (candidate: tuiTypes.RgbColor) =>
    surfaces.every((surface) => wcagContrast(candidate, surface) >= TEXT_MINIMUM_WCAG_CONTRAST);
  if (meets(color)) return color;
  const { h, s, l } = okhslOf(color);
  const at = (lightness: number) => okhslColor(h, s, lightness);
  const extreme = lighter ? 1 : 0;
  if (!meets(at(extreme))) return at(extreme);
  let [low, high] = [l, extreme];
  for (let index = 0; index < 20; index++) {
    const middle = (low + high) / 2;
    if (meets(at(middle))) high = middle;
    else low = middle;
  }
  return at(high);
}

function indexedColors(
  saturation: number,
  appearance: ThemeAppearance | undefined,
): SystemThemeColors {
  const colors = {} as Record<ThemeToken, string | number>;
  const dim: ThemeColor[] = [];
  for (const [token, familyName] of Object.entries(TOKEN_FAMILIES) as [ThemeToken, FamilyName][]) {
    if (PANELS.includes(token as ThemeBg)) {
      colors[token] = "";
      continue;
    }
    const neutral = familyName === "neutral";
    colors[token] =
      !neutral && saturation > 0 ? (TOKEN_SLOTS[token] ?? FAMILIES[familyName].slot) : "";
    if (neutral && !FOREGROUND_TOKENS.includes(token as ThemeColor)) dim.push(token as ThemeColor);
  }
  return { appearance, colors, dim };
}
