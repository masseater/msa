import {
  getResolvedThemeColors,
  getThemeExportColors,
} from "../../modes/interactive/theme/theme.ts";
import { nonEmptyOr } from "../platform/index.ts";

function parseColor(color: string): { r: number; g: number; b: number } | undefined {
  const hexMatch = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/u);
  const [, hexR, hexG, hexB] = hexMatch ?? [];
  if (hexR !== undefined && hexG !== undefined && hexB !== undefined) {
    return {
      r: Number.parseInt(hexR, 16),
      g: Number.parseInt(hexG, 16),
      b: Number.parseInt(hexB, 16),
    };
  }
  const rgbMatch = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/u);
  const [, rgbR, rgbG, rgbB] = rgbMatch ?? [];
  if (rgbR !== undefined && rgbG !== undefined && rgbB !== undefined) {
    return {
      r: Number.parseInt(rgbR, 10),
      g: Number.parseInt(rgbG, 10),
      b: Number.parseInt(rgbB, 10),
    };
  }
  return undefined;
}

function getLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function adjustBrightness(color: string, factor: number): string {
  const parsed = parseColor(color);
  if (parsed === undefined) return color;
  const adjust = (c: number) => Math.min(255, Math.max(0, Math.round(c * factor)));
  return `rgb(${adjust(parsed.r)}, ${adjust(parsed.g)}, ${adjust(parsed.b)})`;
}

export function deriveExportColors(baseColor: string): {
  pageBg: string;
  cardBg: string;
  infoBg: string;
} {
  const parsed = parseColor(baseColor);
  if (parsed === undefined) {
    return {
      pageBg: "rgb(24, 24, 30)",
      cardBg: "rgb(30, 30, 36)",
      infoBg: "rgb(60, 55, 40)",
    };
  }

  const luminance = getLuminance(parsed.r, parsed.g, parsed.b);
  const isLight = luminance > 0.5;

  if (isLight) {
    return {
      pageBg: adjustBrightness(baseColor, 0.96),
      cardBg: baseColor,
      infoBg: `rgb(${Math.min(255, parsed.r + 10)}, ${Math.min(255, parsed.g + 5)}, ${Math.max(0, parsed.b - 20)})`,
    };
  }
  return {
    pageBg: adjustBrightness(baseColor, 0.7),
    cardBg: adjustBrightness(baseColor, 0.85),
    infoBg: `rgb(${Math.min(255, parsed.r + 20)}, ${Math.min(255, parsed.g + 15)}, ${parsed.b})`,
  };
}

export function generateThemeVars(themeName?: string): string {
  const colors = getResolvedThemeColors(themeName);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(colors)) {
    lines.push(`--${key}: ${value};`);
  }

  const themeExport = getThemeExportColors(themeName);
  const userMessageBg = nonEmptyOr(colors["userMessageBg"], "#343541");
  const derivedColors = deriveExportColors(userMessageBg);

  lines.push(`--exportPageBg: ${themeExport.pageBg ?? derivedColors.pageBg};`);
  lines.push(`--exportCardBg: ${themeExport.cardBg ?? derivedColors.cardBg};`);
  lines.push(`--exportInfoBg: ${themeExport.infoBg ?? derivedColors.infoBg};`);

  return lines.join("\n      ");
}
