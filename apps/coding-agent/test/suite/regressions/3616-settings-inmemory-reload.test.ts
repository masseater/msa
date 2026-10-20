import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

const { joinPath } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempDir: string;

let agentDir: string;

const preservesInitialSettingsAfterDirectReload = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    defaultThinkingLevel: "high",
    images: { autoResize: false },
  });

  yield* Effect.promise(() => settingsManager.reload());

  expect(settingsManager.getDefaultThinkingLevel()).toBe("high");
  expect(settingsManager.getImageAutoResize()).toBe(false);
  expect(settingsManager.getCompactionEnabled()).toBe(false);
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
    agentDir,
    cwd: tempDir,
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    settingsManager,
  });

  yield* Effect.promise(() => resourceLoader.reload());

  expect(settingsManager.getDefaultThinkingLevel()).toBe("high");
  expect(settingsManager.getImageAutoResize()).toBe(false);
  expect(settingsManager.getCompactionEnabled()).toBe(false);
});

const preservesInitialSettingsAfterAnUnrelated = Effect.gen(function* () {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    images: { autoResize: false },
  });

  settingsManager.setTheme("dark");
  yield* Effect.promise(() => settingsManager.flush());
  yield* Effect.promise(() => settingsManager.reload());

  expect(settingsManager.getTheme()).toBe("dark");
  expect(settingsManager.getImageAutoResize()).toBe(false);
  expect(settingsManager.getCompactionEnabled()).toBe(false);
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

const beforeEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      tempDir = yield* fs.makeTempDirectory({ prefix: `msa-settings-inmemory-` });
      agentDir = joinPath(tempDir, "agent");
      yield* fs.makeDirectory(agentDir, { recursive: true });
    }),
  );

const afterEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      if (tempDir !== "" && (yield* fs.exists(tempDir))) {
        yield* fs.remove(tempDir, { force: true, recursive: true });
      }
    }),
  );

describe("regression #3616: in-memory settings survive reload", () => {
  beforeEach(beforeEachHook);
  afterEach(afterEachHook);
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
