import { fileURLToPath } from "node:url";

import {
  joinPath,
  makeTempDir,
  readJsonFile,
  removeDirs,
  runTest,
  writeJsonFile,
} from "@msa/testing";
import { colorToHex, okhslColor, styleText } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadThemeFromPath, setTerminalColors } from "../src/modes/interactive/theme/theme.ts";

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

describe("theme styles", () => {
  it("renders theme tokens the same as the generic text styler", () =>
    runTest(
      Effect.gen(function* () {
        const theme = yield* loadTheme("dark");
        expect(theme.style("Ready", { fg: "success", bg: "toolSuccessBg", bold: true })).toBe(
          styleText(
            "Ready",
            { fg: theme.colors.success, bg: theme.colors.toolSuccessBg, bold: true },
            "truecolor",
          ),
        );
      }),
    ));

  it("rejects unknown tokens and tokens in the wrong slot", () =>
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
    ));

  it("loads OKLCH theme values", () =>
    runTest(
      Effect.gen(function* () {
        const theme = yield* loadTheme("dark", (json) => {
          json.colors["accent"] = "oklch(62% 0.1 200)";
        });
        expect(theme.colors.accent).toEqual({ kind: "oklch", l: 0.62, c: 0.1, h: 200 });
      }),
    ));

  it("loads OKHSL theme values, including through variables", () =>
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
    ));

  it("detects the appearance unless it is declared", () =>
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
        setTerminalColors({ background: { r: 250, g: 250, b: 250 } });
        expect(paletteOnly.appearance).toBe("light");
      }),
    ));

  it("renders empty tokens as terminal defaults and reports concrete colors for them", () =>
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
          foreground: { r: 200, g: 210, b: 220 },
          background: { r: 10, g: 20, b: 30 },
        });
        expect(colorToHex(theme.colors.text)).toBe("#c8d2dc");
        expect(colorToHex(theme.colors.userMessageBg)).toBe("#0a141e");
      }),
    ));
});
