import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import { join } from "../../test-path.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempDir: string;

let agentDir: string;

const preservesInitialSettingsAfterDirectReload = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory({
    defaultThinkingLevel: "high",
    images: { autoResize: false },
    compaction: { enabled: false },
  });

  yield* Effect.promise(() => settingsManager.reload());

  expect(settingsManager.getDefaultThinkingLevel()).toBe("high");
  expect(settingsManager.getImageAutoResize()).toBe(false);
  expect(settingsManager.getCompactionEnabled()).toBe(false);
  expect(settingsManager.getGlobalSettings()).toEqual({
    defaultThinkingLevel: "high",
    images: { autoResize: false },
    compaction: { enabled: false },
  });
});

const preservesInitialSettingsWhenDefaultresourceloaderReloads = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory({
    defaultThinkingLevel: "high",
    images: { autoResize: false },
    compaction: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: tempDir,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });

  yield* Effect.promise(() => resourceLoader.reload());

  expect(settingsManager.getDefaultThinkingLevel()).toBe("high");
  expect(settingsManager.getImageAutoResize()).toBe(false);
  expect(settingsManager.getCompactionEnabled()).toBe(false);
});

const preservesInitialSettingsAfterAnUnrelated = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory({
    images: { autoResize: false },
    compaction: { enabled: false },
  });

  settingsManager.setTheme("dark");
  yield* Effect.promise(() => settingsManager.flush());
  yield* Effect.promise(() => settingsManager.reload());

  expect(settingsManager.getTheme()).toBe("dark");
  expect(settingsManager.getImageAutoResize()).toBe(false);
  expect(settingsManager.getCompactionEnabled()).toBe(false);
  expect(settingsManager.getGlobalSettings()).toEqual({
    images: { autoResize: false },
    compaction: { enabled: false },
    theme: "dark",
  });
});

describe("regression #3616: in-memory settings survive reload", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir = yield* fs.makeTempDirectory({ prefix: `msa-settings-inmemory-` });
        agentDir = join(tempDir, "agent");
        yield* fs.makeDirectory(agentDir, { recursive: true });
      }),
    ),
  );
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        if (tempDir !== "" && (yield* fs.exists(tempDir))) {
          yield* fs.remove(tempDir, { recursive: true, force: true });
        }
      }),
    ),
  );
  it("preserves initial settings after direct reload", () =>
    Effect.runPromise(preservesInitialSettingsAfterDirectReload));
  it("preserves initial settings when DefaultResourceLoader reloads", () =>
    Effect.runPromise(preservesInitialSettingsWhenDefaultresourceloaderReloads));
  it("preserves initial settings after an unrelated setter, flush, and reload", () =>
    Effect.runPromise(preservesInitialSettingsAfterAnUnrelated));
});
