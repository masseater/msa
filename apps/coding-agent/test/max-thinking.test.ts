import { fileURLToPath } from "node:url";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { isValidThinkingLevel } from "../src/cli/args.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { loadThemeFromPath } from "../src/modes/interactive/theme/theme.ts";

const {
  awaited,
  dirnameOf,
  joinPath,
  makeTempDir,
  readJsonFile,
  removeDirs,
  runTest,
  writeJsonFile,
} = testing;

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const isAcceptedByCliAndSettings = () =>
  runTest(
    Effect.gen(function* () {
      expect(isValidThinkingLevel("max")).toBe(true);

      const settings = SettingsManager.inMemory();
      settings.setDefaultThinkingLevel("max");
      yield* awaited(settings.flush());
      expect(settings.getDefaultThinkingLevel()).toBe("max");
    }),
  );

const fallsBackToThinkingxhighForLegacyThemes = () =>
  runTest(
    Effect.gen(function* () {
      const testDir = yield* makeTempDir("msa-max-theme-");
      tempDirs.push(testDir);
      const currentDir = dirnameOf(fileURLToPath(import.meta.url));
      const darkTheme = (yield* readJsonFile(
        joinPath(currentDir, "../src/modes/interactive/theme/dark.json"),
      )) as { name: string; colors: Record<string, unknown> };
      darkTheme.name = "legacy-theme";
      delete darkTheme.colors["thinkingMax"];
      const themePath = joinPath(testDir, "legacy-theme.json");
      yield* writeJsonFile(themePath, darkTheme);

      const legacyTheme = loadThemeFromPath(themePath);
      expect(legacyTheme.getThinkingBorderColor("max")("border")).toBe(
        legacyTheme.getThinkingBorderColor("xhigh")("border"),
      );
    }),
  );

describe("max thinking level", () => {
  it("is accepted by CLI and settings", isAcceptedByCliAndSettings);

  it("falls back to thinkingXhigh for legacy themes", fallsBackToThinkingxhighForLegacyThemes);
});
