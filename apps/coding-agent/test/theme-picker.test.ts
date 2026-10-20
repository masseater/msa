import { fileURLToPath } from "node:url";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readEnv } from "../src/core/process-env.ts";
import {
  getAvailableThemes,
  getAvailableThemesWithPaths,
  setRegisteredThemes,
} from "../src/modes/interactive/theme/theme.ts";

const { joinPath, makeDirectory, makeTempDir, readJsonFile, removePath, runTest, writeJsonFile } =
  testing;

type ThemeFile = {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
};

let tempRoot: string;

const usesCustomThemeContentNamesInsteadOf = () =>
  runTest(
    Effect.gen(function* () {
      const darkTheme = (yield* readJsonFile(
        fileURLToPath(new URL("../src/modes/interactive/theme/dark.json", import.meta.url)),
      )) as ThemeFile;
      const customTheme: ThemeFile = {
        ...darkTheme,
        name: "bar",
      };

      const themePath = joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "foo.json");
      yield* writeJsonFile(themePath, customTheme);

      expect(getAvailableThemes()).toContain("bar");
      expect(getAvailableThemes()).not.toContain("foo");
      expect(getAvailableThemesWithPaths()).toContainEqual({ name: "bar", path: themePath });
      expect(getAvailableThemesWithPaths().some((theme) => theme.name === "foo")).toBe(false);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempRoot = yield* makeTempDir("msa-theme-picker-");
      const agentDir = joinPath(tempRoot, "agent");
      vi.stubEnv("MSA_CODING_AGENT_DIR", agentDir);
      yield* makeDirectory(joinPath(agentDir, "themes"));
      setRegisteredThemes([]);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      setRegisteredThemes([]);
      yield* removePath(tempRoot);
      vi.unstubAllEnvs();
    }),
  );

describe("theme picker", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  it("uses custom theme content names instead of file names", usesCustomThemeContentNamesInsteadOf);
});
