import {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  readJsonFile,
  removeDirs,
  runTest,
  writeJsonFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SettingsManager } from "../src/core/settings-manager.ts";

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
      settingsPath: joinPath(agentDir, "settings.json"),
      projectSettingsPath: joinPath(projectDir, ".msa", "settings.json"),
      openManager: () => SettingsManager.create(projectDir, agentDir),
    });
  });

const readSettings = (file: string): Effect.Effect<SettingsFile> =>
  readJsonFile(file) as Effect.Effect<SettingsFile>;

describe("SettingsManager - External Edit Preservation", () => {
  it("should preserve file changes to packages array when changing unrelated setting", () =>
    runTest(
      withSettings(({ settingsPath, openManager }) =>
        Effect.gen(function* () {
          yield* writeJsonFile(settingsPath, {
            theme: "dark",
            packages: ["npm:msa-mcp-adapter"],
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
    ));

  it("should preserve file changes to extensions array when changing unrelated setting", () =>
    runTest(
      withSettings(({ settingsPath, openManager }) =>
        Effect.gen(function* () {
          yield* writeJsonFile(settingsPath, {
            theme: "dark",
            extensions: ["/old/extension.ts"],
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
    ));

  it("should preserve external project settings changes when updating unrelated project field", () =>
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
    ));

  it("should let in-memory project changes override external changes for the same project field", () =>
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
    ));
});
