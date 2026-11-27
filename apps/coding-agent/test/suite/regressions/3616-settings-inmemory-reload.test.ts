import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import DefaultResourceLoader from "../../../src/core/default-resource-loader.ts";
import SettingsManager from "../../../src/core/settings-manager.ts";
import tempDirKit from "../../temp-dir.ts";

const { useAgentDir } = tempDirKit;

const dirs = useAgentDir("msa-settings-inmemory-");

const preservesInitialSettingsAfterDirectReload = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    defaultThinkingLevel: "high",
    images: { autoResize: false },
  });

  yield* Effect.promise(() => settingsManager.persistence.reload());

  expect(settingsManager.models.getDefaultThinkingLevel()).toBe("high");
  expect(settingsManager.display.getImageAutoResize()).toBe(false);
  expect(settingsManager.context.getCompactionEnabled()).toBe(false);
  expect(settingsManager.getGlobalSettings()).toEqual({
    compaction: { enabled: false },
    defaultThinkingLevel: "high",
    images: { autoResize: false },
  });
});

const preservesInitialSettingsWhenDefaultresourceloaderReloads = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    defaultThinkingLevel: "high",
    images: { autoResize: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    agentDir: dirs.agentDir,
    cwd: dirs.path,
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    settingsManager,
  });

  yield* Effect.promise(() => resourceLoader.reload());

  expect(settingsManager.models.getDefaultThinkingLevel()).toBe("high");
  expect(settingsManager.display.getImageAutoResize()).toBe(false);
  expect(settingsManager.context.getCompactionEnabled()).toBe(false);
});

const preservesInitialSettingsAfterAnUnrelated = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    images: { autoResize: false },
  });

  settingsManager.display.setTheme("dark");
  yield* Effect.promise(() => settingsManager.persistence.flush());
  yield* Effect.promise(() => settingsManager.persistence.reload());

  expect(settingsManager.display.getTheme()).toBe("dark");
  expect(settingsManager.display.getImageAutoResize()).toBe(false);
  expect(settingsManager.context.getCompactionEnabled()).toBe(false);
  expect(settingsManager.getGlobalSettings()).toEqual({
    compaction: { enabled: false },
    images: { autoResize: false },
    theme: "dark",
  });
});

const preservesInitialSettingsAfterDirectReload2 = () =>
  Effect.runPromise(preservesInitialSettingsAfterDirectReload);

const preservesInitialSettingsWhenDefaultresourceloaderReloads2 = () =>
  Effect.runPromise(preservesInitialSettingsWhenDefaultresourceloaderReloads);

const preservesInitialSettingsAfterAnUnrelatedSetter = () =>
  Effect.runPromise(preservesInitialSettingsAfterAnUnrelated);

describe("regression #3616: in-memory settings survive reload", () => {
  it("preserves initial settings after direct reload", preservesInitialSettingsAfterDirectReload2);
  it(
    "preserves initial settings when DefaultResourceLoader reloads",
    preservesInitialSettingsWhenDefaultresourceloaderReloads2,
  );
  it(
    "preserves initial settings after an unrelated setter, flush, and reload",
    preservesInitialSettingsAfterAnUnrelatedSetter,
  );
});
