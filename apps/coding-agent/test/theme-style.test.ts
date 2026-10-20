import { fileURLToPath } from "node:url";

import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import terminalColors from "../src/modes/interactive/theme/terminal-colors.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";

const { loadThemeFromPath } = themeModule;
const { setTerminalColors } = terminalColors;

const { colorToHex, okhslColor, styleText } = tui;

const { joinPath, makeTempDir, readJsonFile, removeDirs, runTest, writeJsonFile } = testing;

const tempDirs: string[] = [];

type ThemeFile = {
  name: string;
  appearance?: "dark" | "light";
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
};

const loadTheme = Effect.fn("loadTheme")(function* (
  base: "dark" | "light",
  edit: (theme: ThemeFile) => void = () => {},
) {
  const themeJson = (yield* readJsonFile(
    fileURLToPath(new URL(`../src/modes/interactive/theme/${base}.json`, import.meta.url)),
  )) as ThemeFile;
  edit(themeJson);
  const dir = yield* makeTempDir("msa-theme-style-");
  tempDirs.push(dir);
  const path = joinPath(dir, `${themeJson.name}.json`);
  yield* writeJsonFile(path, themeJson);
  return loadThemeFromPath(path, "truecolor");
});

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      setTerminalColors({});
      yield* removeDirs(tempDirs.splice(0));
    }),
  ),
);

const rendersThemeTokensTheSameAsThe = () =>
  runTest(
    Effect.gen(function* () {
      const theme = yield* loadTheme("dark");
      expect(theme.style("Ready", { bg: "toolSuccessBg", bold: true, fg: "success" })).toBe(
        styleText(
          "Ready",
          { bg: theme.colors.toolSuccessBg, bold: true, fg: theme.colors.success },
          "truecolor",
        ),
      );
    }),
  );

const rejectsUnknownTokensAndTokensInThe = () =>
  runTest(
    Effect.gen(function* () {
      const theme = yield* loadTheme("dark");
      expect(() => theme.style("x", { fg: "notAToken" as never })).toThrow(
        "Unknown theme color: notAToken",
      );
      expect(() => theme.style("x", { fg: "userMessageBg" as never })).toThrow(
        "Unknown theme color: userMessageBg",
      );
    }),
  );

const loadsOklchThemeValues = () =>
  runTest(
    Effect.gen(function* () {
      const theme = yield* loadTheme("dark", (json) => {
        json.colors["accent"] = "oklch(62% 0.1 200)";
      });
      expect(theme.colors.accent).toEqual({ c: 0.1, h: 200, kind: "oklch", l: 0.62 });
    }),
  );

const loadsOkhslThemeValuesIncludingThroughVariables = () =>
  runTest(
    Effect.gen(function* () {
      const theme = yield* loadTheme("dark", (json) => {
        json.vars = { ...json.vars, brand: "okhsl(250 60% 55%)" };
        json.colors["accent"] = "brand";
        json.colors["error"] = "okhsl(20 90% 60%)";
      });
      expect(colorToHex(theme.colors.accent)).toBe(colorToHex(okhslColor(250, 0.6, 0.55)));
      expect(colorToHex(theme.colors.error)).toBe(colorToHex(okhslColor(20, 0.9, 0.6)));
    }),
  );

const detectsTheAppearanceUnlessItIsDeclared = () =>
  runTest(
    Effect.gen(function* () {
      expect((yield* loadTheme("dark")).appearance).toBe("dark");
      expect((yield* loadTheme("light")).appearance).toBe("light");

      for (const base of ["dark", "light"] as const) {
        expect((yield* loadTheme(base, (json) => delete json.appearance)).appearance).toBe(base);
      }
      expect(
        (yield* loadTheme("dark", (json) => {
          json.appearance = "light";
        })).appearance,
      ).toBe("light");

      const paletteOnly = yield* loadTheme("dark", (json) => {
        delete json.appearance;
        for (const key of Object.keys(json.colors)) json.colors[key] = key.endsWith("Bg") ? 0 : 7;
      });
      expect(paletteOnly.appearance).toBe("dark");
      setTerminalColors({ background: { b: 250, g: 250, r: 250 } });
      expect(paletteOnly.appearance).toBe("light");
    }),
  );

const rendersEmptyTokensAsTerminalDefaultsAnd = () =>
  runTest(
    Effect.gen(function* () {
      const theme = yield* loadTheme("dark", (json) => {
        json.colors["text"] = "";
        json.colors["userMessageBg"] = "";
      });
      expect(theme.fg("text", "x")).toBe("\x1b[39mx\x1b[39m");
      expect(theme.bg("userMessageBg", "x")).toBe("\x1b[49mx\x1b[49m");
      expect(colorToHex(theme.colors.text)).toBe("#e5e5e7");
      expect(colorToHex(theme.colors.userMessageBg)).toBe("#000000");

      setTerminalColors({
        background: { b: 30, g: 20, r: 10 },
        foreground: { b: 220, g: 210, r: 200 },
      });
      expect(colorToHex(theme.colors.text)).toBe("#c8d2dc");
      expect(colorToHex(theme.colors.userMessageBg)).toBe("#0a141e");
    }),
  );

describe("theme styles", () => {
  it("renders theme tokens the same as the generic text styler", rendersThemeTokensTheSameAsThe);

  it("rejects unknown tokens and tokens in the wrong slot", rejectsUnknownTokensAndTokensInThe);

  it("loads OKLCH theme values", loadsOklchThemeValues);

  it(
    "loads OKHSL theme values, including through variables",
    loadsOkhslThemeValuesIncludingThroughVariables,
  );

  it("detects the appearance unless it is declared", detectsTheAppearanceUnlessItIsDeclared);

  it(
    "renders empty tokens as terminal defaults and reports concrete colors for them",
    rendersEmptyTokensAsTerminalDefaultsAnd,
  );
});
