import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SettingsManager } from "../src/core/settings-manager.ts";

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  readJsonFile,
  removeDirs,
  runTest,
  writeJsonFile,
} = testing;

interface SettingsFile {
  theme?: unknown;
  packages?: unknown;
  extensions?: unknown;
  prompts?: unknown;
}

interface SettingsPaths {
  readonly settingsPath: string;
  readonly projectSettingsPath: string;
  readonly openManager: () => SettingsManager;
}

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const withSettings = <A, E>(
  use: (paths: SettingsPaths) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const testDir = yield* makeTempDir("settings-bug-test-");
    tempDirs.push(testDir);
    const agentDir = joinPath(testDir, "agent");
    const projectDir = joinPath(testDir, "project");
    yield* makeDirectory(agentDir);
    yield* makeDirectory(joinPath(projectDir, ".msa"));
    return yield* use({
      openManager: () => SettingsManager.create(projectDir, agentDir),
      projectSettingsPath: joinPath(projectDir, ".msa", "settings.json"),
      settingsPath: joinPath(agentDir, "settings.json"),
    });
  });

const readSettings = (file: string): Effect.Effect<SettingsFile> =>
  readJsonFile(file) as Effect.Effect<SettingsFile>;

const shouldPreserveFileChangesToPackagesArray = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          packages: ["npm:msa-mcp-adapter"],
          theme: "dark",
        });

        const manager = openManager();

        expect(manager.getPackages()).toEqual(["npm:msa-mcp-adapter"]);

        const currentSettings = yield* readSettings(settingsPath);
        currentSettings.packages = [];
        yield* writeJsonFile(settingsPath, currentSettings);

        expect((yield* readSettings(settingsPath)).packages).toEqual([]);

        manager.setTheme("light");
        yield* awaited(manager.flush());

        const savedSettings = yield* readSettings(settingsPath);

        expect(savedSettings.packages).toEqual([]);
        expect(savedSettings.theme).toBe("light");
      }),
    ),
  );

const shouldPreserveFileChangesToExtensionsArray = () =>
  runTest(
    withSettings(({ settingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(settingsPath, {
          extensions: ["/old/extension.ts"],
          theme: "dark",
        });

        const manager = openManager();

        const currentSettings = yield* readSettings(settingsPath);
        currentSettings.extensions = ["/new/extension.ts"];
        yield* writeJsonFile(settingsPath, currentSettings);

        manager.setDefaultThinkingLevel("high");
        yield* awaited(manager.flush());

        const savedSettings = yield* readSettings(settingsPath);

        expect(savedSettings.extensions).toEqual(["/new/extension.ts"]);
      }),
    ),
  );

const shouldPreserveExternalProjectSettingsChangesWhen = () =>
  runTest(
    withSettings(({ projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(projectSettingsPath, {
          extensions: ["./old-extension.ts"],
          prompts: ["./old-prompt.md"],
        });

        const manager = openManager();

        const currentProjectSettings = yield* readSettings(projectSettingsPath);
        currentProjectSettings.prompts = ["./new-prompt.md"];
        yield* writeJsonFile(projectSettingsPath, currentProjectSettings);

        manager.setProjectExtensionPaths(["./updated-extension.ts"]);
        yield* awaited(manager.flush());

        const savedProjectSettings = yield* readSettings(projectSettingsPath);
        expect(savedProjectSettings.prompts).toEqual(["./new-prompt.md"]);
        expect(savedProjectSettings.extensions).toEqual(["./updated-extension.ts"]);
      }),
    ),
  );

const shouldLetInMemoryProjectChangesOverride = () =>
  runTest(
    withSettings(({ projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        yield* writeJsonFile(projectSettingsPath, {
          extensions: ["./initial-extension.ts"],
        });

        const manager = openManager();

        const currentProjectSettings = yield* readSettings(projectSettingsPath);
        currentProjectSettings.extensions = ["./external-extension.ts"];
        yield* writeJsonFile(projectSettingsPath, currentProjectSettings);

        manager.setProjectExtensionPaths(["./in-memory-extension.ts"]);
        yield* awaited(manager.flush());

        const savedProjectSettings = yield* readSettings(projectSettingsPath);
        expect(savedProjectSettings.extensions).toEqual(["./in-memory-extension.ts"]);
      }),
    ),
  );

describe("SettingsManager - External Edit Preservation", () => {
  it(
    "should preserve file changes to packages array when changing unrelated setting",
    shouldPreserveFileChangesToPackagesArray,
  );

  it(
    "should preserve file changes to extensions array when changing unrelated setting",
    shouldPreserveFileChangesToExtensionsArray,
  );

  it(
    "should preserve external project settings changes when updating unrelated project field",
    shouldPreserveExternalProjectSettingsChangesWhen,
  );

  it(
    "should let in-memory project changes override external changes for the same project field",
    shouldLetInMemoryProjectChangesOverride,
  );
});
