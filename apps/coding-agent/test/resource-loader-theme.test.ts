import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import config from "../src/config.ts";
import DefaultResourceLoader from "../src/core/default-resource-loader.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import themeSchema from "../src/modes/interactive/theme/theme-schema.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";

const { setThemeJsonValidator } = themeModule;
const { validateThemeJson } = themeSchema;
const { getThemesDir } = config;

const { resetCapabilitiesCache, setCapabilityOverrides } = tui;

const {
  awaited,
  fromJsonText,
  joinPath,
  makeDirectory,
  makeTempDir,
  readTextFile,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

setThemeJsonValidator(validateThemeJson);

interface TestThemeJson {
  name: string;
  colors: Record<string, string | number>;
  unsupported?: boolean;
}

let tempDir: string;

let agentDir: string;

let cwd: string;

let themePath: string;

let themeJson: TestThemeJson;

const returnsToAutomaticDetectionAfterAnExplicit = Effect.gen(function* () {
  vi.stubEnv("MSA_TRUE_COLOR", "1");
  setCapabilityOverrides({});
  resetCapabilitiesCache();

  const settingsPath = joinPath(agentDir, "settings.json");
  yield* writeTextFile(settingsPath, yield* toJsonText({ terminal: { trueColor: false } }));
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const loader = new DefaultResourceLoader({
    additionalThemePaths: [themePath],
    agentDir,
    cwd,
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    settingsManager,
  });
  yield* awaited(loader.reload());
  setCapabilityOverrides(settingsManager.terminal.getTerminalCapabilityOverrides());

  yield* writeTextFile(settingsPath, "{}");
  yield* awaited(loader.reload());

  const loadedTheme = loader.getThemes().themes.find((theme) => theme.name === "capability-test");
  expect(loadedTheme?.bg("userMessageBg", "x")).toBe("\x1b[48;2;60;53;68mx\x1b[49m");
});

const afterEachHook = Effect.gen(function* () {
  vi.unstubAllEnvs();
  setCapabilityOverrides({});
  resetCapabilitiesCache();
  yield* removePath(tempDir);
});

const stepStep = () => {
  afterEach(() => runTest(afterEachHook));
  it.each([
    {
      environment: "256-color",
      environmentOverride: "0",
      expected: "\x1b[48;2;60;53;68mx\x1b[49m",
      setting: true,
    },
    {
      environment: "truecolor",
      environmentOverride: "1",
      expected: "\x1b[48;5;59mx\x1b[49m",
      setting: false,
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
            additionalThemePaths: [themePath],
            agentDir,
            cwd,
            noContextFiles: true,
            noExtensions: true,
            noPromptTemplates: true,
            noSkills: true,
            settingsManager: SettingsManager.inMemory({ terminal: { trueColor: setting } }),
          });
          yield* awaited(loader.reload());

          const loadedTheme = loader
            .getThemes()
            .themes.find((theme) => theme.name === "capability-test");
          expect(loadedTheme?.bg("userMessageBg", "x")).toBe(expected);
        }),
      ),
  );
};

describe("DefaultResourceLoader theme color mode", () => {
  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* makeTempDir("resource-loader-theme-");
        agentDir = joinPath(tempDir, "agent");
        cwd = joinPath(tempDir, "project");
        yield* makeDirectory(agentDir);
        yield* makeDirectory(cwd);
        themeJson = (yield* fromJsonText(
          yield* readTextFile(joinPath(getThemesDir(), "dark.json")),
        )) as TestThemeJson;
        themeJson.name = "capability-test";
        themeJson.colors["userMessageBg"] = "#3c3544";
        themePath = joinPath(tempDir, "capability-test.json");
        yield* writeTextFile(themePath, yield* toJsonText(themeJson));
      }),
    ),
  );

  stepStep();
});

describe("DefaultResourceLoader theme color mode", () => {
  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* makeTempDir("resource-loader-theme-");
        agentDir = joinPath(tempDir, "agent");
        cwd = joinPath(tempDir, "project");
        yield* makeDirectory(agentDir);
        yield* makeDirectory(cwd);
        themeJson = (yield* fromJsonText(
          yield* readTextFile(joinPath(getThemesDir(), "dark.json")),
        )) as TestThemeJson;
        themeJson.name = "capability-test";
        themeJson.colors["userMessageBg"] = "#3c3544";
        themePath = joinPath(tempDir, "capability-test.json");
        yield* writeTextFile(themePath, yield* toJsonText(themeJson));
      }),
    ),
  );

  afterEach(() => runTest(afterEachHook));

  it("returns to automatic detection after an explicit setting is removed", () =>
    runTest(returnsToAutomaticDetectionAfterAnExplicit));
});

const stepStep2 = () => {
  afterEach(() => runTest(afterEachHook));
  it("applies strict validation on initial load and reload", () =>
    runTest(
      Effect.gen(function* () {
        const loader = new DefaultResourceLoader({
          additionalThemePaths: [themePath],
          agentDir,
          cwd,
          noContextFiles: true,
          noExtensions: true,
          noPromptTemplates: true,
          noSkills: true,
          settingsManager: SettingsManager.inMemory(),
        });

        themeJson.unsupported = true;
        yield* writeTextFile(themePath, yield* toJsonText(themeJson));
        yield* awaited(loader.reload());
        const initialDiagnostics = loader.getThemes().diagnostics;
        expect(initialDiagnostics).toHaveLength(1);
        expect(initialDiagnostics[0]).toMatchObject({ path: themePath, type: "warning" as const });
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
};

describe("DefaultResourceLoader theme color mode", () => {
  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* makeTempDir("resource-loader-theme-");
        agentDir = joinPath(tempDir, "agent");
        cwd = joinPath(tempDir, "project");
        yield* makeDirectory(agentDir);
        yield* makeDirectory(cwd);
        themeJson = (yield* fromJsonText(
          yield* readTextFile(joinPath(getThemesDir(), "dark.json")),
        )) as TestThemeJson;
        themeJson.name = "capability-test";
        themeJson.colors["userMessageBg"] = "#3c3544";
        themePath = joinPath(tempDir, "capability-test.json");
        yield* writeTextFile(themePath, yield* toJsonText(themeJson));
      }),
    ),
  );

  stepStep2();
});
