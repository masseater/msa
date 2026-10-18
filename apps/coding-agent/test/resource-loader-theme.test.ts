import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { awaited, runTest, toJsonText, writeTextFile, joinPath } from "@msa/testing";
import { resetCapabilitiesCache, setCapabilityOverrides } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getThemesDir } from "../src/config.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { validateThemeJson } from "../src/modes/interactive/theme/theme-schema.ts";
import { setThemeJsonValidator } from "../src/modes/interactive/theme/theme.ts";

setThemeJsonValidator(validateThemeJson);

interface TestThemeJson {
  name: string;
  colors: Record<string, string | number>;
  unsupported?: boolean;
}

describe("DefaultResourceLoader theme color mode", () => {
  let tempDir: string;
  let agentDir: string;
  let cwd: string;
  let themePath: string;
  let themeJson: TestThemeJson;

  beforeEach(() => {
    tempDir = mkdtempSync(joinPath(tmpdir(), "resource-loader-theme-"));
    agentDir = joinPath(tempDir, "agent");
    cwd = joinPath(tempDir, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    themeJson = JSON.parse(
      readFileSync(joinPath(getThemesDir(), "dark.json"), "utf-8"),
    ) as TestThemeJson;
    themeJson.name = "capability-test";
    themeJson.colors["userMessageBg"] = "#3c3544";
    themePath = joinPath(tempDir, "capability-test.json");
    writeFileSync(themePath, JSON.stringify(themeJson));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setCapabilityOverrides({});
    resetCapabilitiesCache();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it.each([
    {
      environment: "256-color",
      environmentOverride: "0",
      setting: true,
      expected: "\x1b[48;2;60;53;68mx\x1b[49m",
    },
    {
      environment: "truecolor",
      environmentOverride: "1",
      setting: false,
      expected: "\x1b[48;5;59mx\x1b[49m",
    },
  ])(
    "uses the $setting setting over a $environment environment",
    ({ environmentOverride, setting, expected }) =>
      runTest(
        Effect.gen(function* () {
          vi.stubEnv("MSA_TRUE_COLOR", environmentOverride);
          setCapabilityOverrides({});
          resetCapabilitiesCache();

          const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            settingsManager: SettingsManager.inMemory({ terminal: { trueColor: setting } }),
            additionalThemePaths: [themePath],
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noContextFiles: true,
          });
          yield* awaited(loader.reload());

          const loadedTheme = loader
            .getThemes()
            .themes.find((theme) => theme.name === "capability-test");
          expect(loadedTheme?.bg("userMessageBg", "x")).toBe(expected);
        }),
      ),
  );

  it("returns to automatic detection after an explicit setting is removed", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubEnv("MSA_TRUE_COLOR", "1");
        setCapabilityOverrides({});
        resetCapabilitiesCache();

        const settingsPath = joinPath(agentDir, "settings.json");
        yield* writeTextFile(settingsPath, yield* toJsonText({ terminal: { trueColor: false } }));
        const settingsManager = SettingsManager.create(cwd, agentDir);
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager,
          additionalThemePaths: [themePath],
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noContextFiles: true,
        });
        yield* awaited(loader.reload());
        setCapabilityOverrides(settingsManager.getTerminalCapabilityOverrides());

        yield* writeTextFile(settingsPath, "{}");
        yield* awaited(loader.reload());

        const loadedTheme = loader
          .getThemes()
          .themes.find((theme) => theme.name === "capability-test");
        expect(loadedTheme?.bg("userMessageBg", "x")).toBe("\x1b[48;2;60;53;68mx\x1b[49m");
      }),
    ));

  it("applies strict validation on initial load and reload", () =>
    runTest(
      Effect.gen(function* () {
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager: SettingsManager.inMemory(),
          additionalThemePaths: [themePath],
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noContextFiles: true,
        });

        themeJson.unsupported = true;
        yield* writeTextFile(themePath, yield* toJsonText(themeJson));
        yield* awaited(loader.reload());
        const initialDiagnostics = loader.getThemes().diagnostics;
        expect(initialDiagnostics).toHaveLength(1);
        expect(initialDiagnostics[0]).toMatchObject({ type: "warning" as const, path: themePath });
        expect(initialDiagnostics[0]?.message).toContain("/unsupported");

        delete themeJson.unsupported;
        yield* writeTextFile(themePath, yield* toJsonText(themeJson));
        yield* awaited(loader.reload());
        expect(loader.getThemes().diagnostics).toEqual([]);
        expect(loader.getThemes().themes.some((theme) => theme.name === themeJson.name)).toBe(true);

        themeJson.unsupported = true;
        yield* writeTextFile(themePath, yield* toJsonText(themeJson));
        yield* awaited(loader.reload());
        expect(loader.getThemes().diagnostics).toEqual(initialDiagnostics);
      }),
    ));
});
