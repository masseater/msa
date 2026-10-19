import { fileURLToPath } from "node:url";

import {
  joinPath,
  makeTempDir,
  readJsonFile,
  removeDirs,
  runTest,
  writeJsonFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { validateThemeJson } from "../src/modes/interactive/theme/theme-schema.ts";
import { loadThemeFromPath, setThemeJsonValidator } from "../src/modes/interactive/theme/theme.ts";

setThemeJsonValidator(validateThemeJson);

const tempDirs: string[] = [];

interface Theme {
  name: string;
  colors: Record<string, string | number>;
}

const loadDarkTheme = Effect.gen(function* () {
  return (yield* readJsonFile(
    fileURLToPath(new URL("../src/modes/interactive/theme/dark.json", import.meta.url)),
  )) as Theme;
});

const writeTheme = Effect.fn("writeTheme")(function* (theme: Theme) {
  const testDir = yield* makeTempDir("msa-scrollbar-theme-");
  tempDirs.push(testDir);
  const themePath = joinPath(testDir, `${theme.name}.json`);
  yield* writeJsonFile(themePath, theme);
  return themePath;
});

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

describe("fullscreen theme colors", () => {
  it.each([
    ["scrollbarTrack", "muted"],
    ["scrollbarThumb", "text"],
  ] as const)("falls back to %s when omitted", (token, fallback) =>
    runTest(
      Effect.gen(function* () {
        const themeJson = yield* loadDarkTheme;
        themeJson.name = `missing-${token}-theme`;
        delete themeJson.colors[token];

        const loadedTheme = loadThemeFromPath(yield* writeTheme(themeJson), "truecolor");
        expect(loadedTheme.getFgAnsi(token)).toBe(loadedTheme.getFgAnsi(fallback));
      }),
    ),
  );

  it("uses explicitly configured scrollbar colors", () =>
    runTest(
      Effect.gen(function* () {
        const themeJson = yield* loadDarkTheme;
        themeJson.name = "custom-scrollbar-theme";
        themeJson.colors["scrollbarTrack"] = "#654321";
        themeJson.colors["scrollbarThumb"] = "#123456";

        const loadedTheme = loadThemeFromPath(yield* writeTheme(themeJson), "truecolor");
        expect(loadedTheme.getFgAnsi("scrollbarTrack")).toBe("\x1b[38;2;101;67;33m");
        expect(loadedTheme.getFgAnsi("scrollbarThumb")).toBe("\x1b[38;2;18;52;86m");
      }),
    ));

  it("falls back to existing selection and text colors for search highlights", () =>
    runTest(
      Effect.gen(function* () {
        const themeJson = yield* loadDarkTheme;
        themeJson.name = "legacy-search-theme";
        delete themeJson.colors["searchMatchBg"];
        delete themeJson.colors["searchMatchText"];

        const loadedTheme = loadThemeFromPath(yield* writeTheme(themeJson), "truecolor");
        expect(loadedTheme.getBgAnsi("searchMatchBg")).toBe(loadedTheme.getBgAnsi("selectedBg"));
        expect(loadedTheme.getFgAnsi("searchMatchText")).toBe(loadedTheme.getFgAnsi("text"));
      }),
    ));

  it("uses explicitly configured search highlight colors", () =>
    runTest(
      Effect.gen(function* () {
        const themeJson = yield* loadDarkTheme;
        themeJson.name = "custom-search-theme";
        themeJson.colors["searchMatchBg"] = "#112233";
        themeJson.colors["searchMatchText"] = "#223344";

        const loadedTheme = loadThemeFromPath(yield* writeTheme(themeJson), "truecolor");
        expect(loadedTheme.getBgAnsi("searchMatchBg")).toBe("\x1b[48;2;17;34;51m");
        expect(loadedTheme.getFgAnsi("searchMatchText")).toBe("\x1b[38;2;34;51;68m");
      }),
    ));
});
