import { fileURLToPath } from "url";

import testing from "@msa/testing";
import { colorToHex, okhslColor } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readEnv } from "../src/core/process-env.ts";
import { getThemeExportColors } from "../src/modes/interactive/theme/theme.ts";

const {
  joinPath,
  makeDirectory,
  makeTempDir,
  readJsonFile,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

type ThemeFile = {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
  export?: {
    pageBg?: string | number;
    cardBg?: string | number;
    infoBg?: string | number;
  };
};

const DARK_THEME_PATH = fileURLToPath(
  new URL("../src/modes/interactive/theme/dark.json", import.meta.url),
);

let tempRoot: string;

const convertsOkhslExportColorsToHexBecause = () =>
  runTest(
    Effect.gen(function* () {
      const darkTheme = (yield* readJsonFile(DARK_THEME_PATH)) as ThemeFile;
      const customTheme: ThemeFile = {
        ...darkTheme,
        export: { cardBg: "card", infoBg: "oklch(30% 0.05 80)", pageBg: "okhsl(250 20% 15%)" },
        name: "custom-export-okhsl",
        vars: { card: "okhsl(250 20% 20%)" },
      };
      yield* writeTextFile(
        joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-okhsl.json"),
        yield* toJsonText(customTheme),
      );

      expect(getThemeExportColors("custom-export-okhsl")).toEqual({
        cardBg: colorToHex(okhslColor(250, 0.2, 0.2)),
        infoBg: "oklch(30% 0.05 80)",
        pageBg: colorToHex(okhslColor(250, 0.2, 0.15)),
      });
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempRoot = yield* makeTempDir("msa-theme-export-");
      vi.stubEnv("MSA_CODING_AGENT_DIR", joinPath(tempRoot, "agent"));
      yield* makeDirectory(joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes"));
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      yield* removePath(tempRoot);
      vi.stubEnv("MSA_CODING_AGENT_DIR", undefined);
    }),
  );

describe("getThemeExportColors", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it("resolves export variable references using the same syntax as colors", () =>
    runTest(
      Effect.gen(function* () {
        const darkTheme = (yield* readJsonFile(DARK_THEME_PATH)) as ThemeFile;

        const customTheme: ThemeFile = {
          ...darkTheme,
          export: {
            cardBg: "cardBgVar",
            infoBg: "infoBgVar",
            pageBg: "pageBgAlias",
          },
          name: "custom-export-vars",
          vars: {
            ...(darkTheme.vars ?? {}),
            cardBgVar: "#223344",
            infoBgVar: "#445566",
            pageBgAlias: "pageBgVar",
            pageBgVar: "#112233",
          },
        };

        yield* writeTextFile(
          joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-vars.json"),
          yield* toJsonText(customTheme),
        );

        expect(getThemeExportColors("custom-export-vars")).toEqual({
          cardBg: "#223344",
          infoBg: "#445566",
          pageBg: "#112233",
        });
      }),
    ));
});

describe("getThemeExportColors", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it(
    "converts OKHSL export colors to hex because CSS does not support them",
    convertsOkhslExportColorsToHexBecause,
  );
});

describe("getThemeExportColors", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it("resolves recursive vars and converts 256-color export values to hex", () =>
    runTest(
      Effect.gen(function* () {
        const darkTheme = (yield* readJsonFile(DARK_THEME_PATH)) as ThemeFile;

        const customTheme: ThemeFile = {
          ...darkTheme,
          export: {
            cardBg: "cardBgAnsi",
            infoBg: "",
            pageBg: "pageBgAlias",
          },
          name: "custom-export-recursive",
          vars: {
            ...(darkTheme.vars ?? {}),
            cardBgAnsi: 24,
            deepPageBg: "#abcdef",
            pageBgAlias: "deepPageBg",
          },
        };

        yield* writeTextFile(
          joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-recursive.json"),
          yield* toJsonText(customTheme),
        );

        expect(getThemeExportColors("custom-export-recursive")).toEqual({
          cardBg: "#005f87",
          infoBg: undefined,
          pageBg: "#abcdef",
        });
      }),
    ));
});
