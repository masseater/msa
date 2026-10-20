import { resetCapabilitiesCache, setCapabilities } from "@msa/tui";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  detectColorFgBgTheme,
  detectTerminalTheme,
  getThemeByName,
  parseAutoThemeSetting,
  resolveThemeSetting,
} from "../src/modes/interactive/theme/theme.ts";

const ESC = String.fromCharCode(27);

afterEach(() => {
  resetCapabilitiesCache();
});

const classifiesTheLastFieldByPaletteIndex = () => {
  expect(detectColorFgBgTheme({ COLORFGBG: "15;0" })).toBe("dark");
  expect(detectColorFgBgTheme({ COLORFGBG: "0;7;15" })).toBe("light");

  expect(detectColorFgBgTheme({ COLORFGBG: "12;8" })).toBe("dark");

  expect(detectColorFgBgTheme({ COLORFGBG: "15;default" })).toBeUndefined();
  expect(detectColorFgBgTheme({})).toBeUndefined();
};

describe("detectColorFgBgTheme", () => {
  it("classifies the last field by palette index like Vim", classifiesTheLastFieldByPaletteIndex);
});

const prefersTheBackgroundThenTheReportedScheme = () => {
  const env = { COLORFGBG: "0;15" };
  expect(detectTerminalTheme({ background: { b: 8, g: 8, r: 8 } }, "light", env)).toBe("dark");
  expect(detectTerminalTheme({}, "dark", env)).toBe("dark");
  expect(detectTerminalTheme({}, undefined, env)).toBe("light");
  expect(detectTerminalTheme({}, undefined, {})).toBe("dark");
};

const followsTheForegroundWhenTextIsReadable = () => {
  const background = { b: 118, g: 118, r: 118 };
  expect(detectTerminalTheme({ background })).toBe("light");
  expect(detectTerminalTheme({ background, foreground: { b: 255, g: 255, r: 255 } })).toBe("dark");

  const midGray = { b: 128, g: 128, r: 128 };
  expect(detectTerminalTheme({ background: midGray, foreground: { b: 255, g: 255, r: 255 } })).toBe(
    "light",
  );
};

describe("detectTerminalTheme", () => {
  it(
    "prefers the background, then the reported scheme, then COLORFGBG, then dark",
    prefersTheBackgroundThenTheReportedScheme,
  );

  it(
    "follows the foreground when text is readable that way",
    followsTheForegroundWhenTextIsReadable,
  );
});

const usesTerminalCapabilities = () => {
  setCapabilities({ hyperlinks: false, images: null, trueColor: false });
  const ansi256Theme = getThemeByName("dark");
  if (!(ansi256Theme !== undefined)) throw new Error("dark theme not found");
  expect(ansi256Theme.getColorMode()).toBe("256color");
  expect(ansi256Theme.getFgAnsi("accent")).toMatch(new RegExp(`^${ESC}\\[38;5;\\d+m$`, "u"));

  setCapabilities({ hyperlinks: false, images: null, trueColor: true });
  const truecolorTheme = getThemeByName("dark");
  if (!(truecolorTheme !== undefined)) throw new Error("dark theme not found");
  expect(truecolorTheme.getColorMode()).toBe("truecolor");
  expect(truecolorTheme.getFgAnsi("accent")).toMatch(
    new RegExp(`^${ESC}\\[38;2;\\d+;\\d+;\\d+m$`, "u"),
  );
};

describe("theme color mode", () => {
  it("uses terminal capabilities", usesTerminalCapabilities);
});

const parsesAndResolvesAutomaticThemeSettings = () => {
  expect(parseAutoThemeSetting("light/dark")).toEqual({ darkTheme: "dark", lightTheme: "light" });
  expect(resolveThemeSetting("dark", "light")).toBe("dark");
  expect(resolveThemeSetting("light/dark", "light")).toBe("light");
  expect(resolveThemeSetting("light/dark", "dark")).toBe("dark");
  expect(resolveThemeSetting("light/dark/extra", "dark")).toBeUndefined();
};

describe("theme setting helpers", () => {
  it("parses and resolves automatic theme settings", parsesAndResolvesAutomaticThemeSettings);
});
