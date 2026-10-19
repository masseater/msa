import { fileURLToPath } from "url";

import {
  joinPath,
  runTest,
  makeDirectory,
  makeTempDir,
  readJsonFile,
  removePath,
  toJsonText,
  writeTextFile,
} from "@msa/testing";
import { colorToHex, okhslColor } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readEnv } from "../src/core/process-env.ts";
import { getThemeExportColors } from "../src/modes/interactive/theme/theme.ts";

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

describe("getThemeExportColors", () => {
  let tempRoot: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempRoot = yield* makeTempDir("msa-theme-export-");
        vi.stubEnv("MSA_CODING_AGENT_DIR", joinPath(tempRoot, "agent"));
        yield* makeDirectory(joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes"));
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* removePath(tempRoot);
        vi.stubEnv("MSA_CODING_AGENT_DIR", undefined);
      }),
    ),
  );

  it("resolves export variable references using the same syntax as colors", () =>
    runTest(
      Effect.gen(function* () {
        const darkTheme = (yield* readJsonFile(DARK_THEME_PATH)) as ThemeFile;

        const customTheme: ThemeFile = {
          ...darkTheme,
          name: "custom-export-vars",
          vars: {
            ...(darkTheme.vars ?? {}),
            pageBgVar: "#112233",
            pageBgAlias: "pageBgVar",
            infoBgVar: "#445566",
            cardBgVar: "#223344",
          },
          export: {
            pageBg: "pageBgAlias",
            cardBg: "cardBgVar",
            infoBg: "infoBgVar",
          },
        };

        yield* writeTextFile(
          joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-vars.json"),
          yield* toJsonText(customTheme),
        );

        expect(getThemeExportColors("custom-export-vars")).toEqual({
          pageBg: "#112233",
          cardBg: "#223344",
          infoBg: "#445566",
        });
      }),
    ));

  it("converts OKHSL export colors to hex because CSS does not support them", () =>
    runTest(
      Effect.gen(function* () {
        const darkTheme = (yield* readJsonFile(DARK_THEME_PATH)) as ThemeFile;
        const customTheme: ThemeFile = {
          ...darkTheme,
          name: "custom-export-okhsl",
          vars: { card: "okhsl(250 20% 20%)" },
          export: { pageBg: "okhsl(250 20% 15%)", cardBg: "card", infoBg: "oklch(30% 0.05 80)" },
        };
        yield* writeTextFile(
          joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-okhsl.json"),
          yield* toJsonText(customTheme),
        );

        expect(getThemeExportColors("custom-export-okhsl")).toEqual({
          pageBg: colorToHex(okhslColor(250, 0.2, 0.15)),
          cardBg: colorToHex(okhslColor(250, 0.2, 0.2)),
          infoBg: "oklch(30% 0.05 80)",
        });
      }),
    ));

  it("resolves recursive vars and converts 256-color export values to hex", () =>
    runTest(
      Effect.gen(function* () {
        const darkTheme = (yield* readJsonFile(DARK_THEME_PATH)) as ThemeFile;

        const customTheme: ThemeFile = {
          ...darkTheme,
          name: "custom-export-recursive",
          vars: {
            ...(darkTheme.vars ?? {}),
            deepPageBg: "#abcdef",
            pageBgAlias: "deepPageBg",
            cardBgAnsi: 24,
          },
          export: {
            pageBg: "pageBgAlias",
            cardBg: "cardBgAnsi",
            infoBg: "",
          },
        };

        yield* writeTextFile(
          joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-recursive.json"),
          yield* toJsonText(customTheme),
        );

        expect(getThemeExportColors("custom-export-recursive")).toEqual({
          pageBg: "#abcdef",
          cardBg: "#005f87",
          infoBg: undefined,
        });
      }),
    ));
});
