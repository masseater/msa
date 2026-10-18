import { joinPath, makeDirectory, makeTempDir, readJsonFile, removeDirs } from "@msa/testing";
import { Effect } from "effect";

import { SettingsManager } from "../src/core/settings-manager.ts";

export interface SettingsPaths {
  readonly agentDir: string;
  readonly projectDir: string;
  readonly settingsPath: string;
  readonly projectSettingsPath: string;
  readonly openManager: (options?: { projectTrusted?: boolean }) => SettingsManager;
}

const tempDirs: string[] = [];

export const removeSettingsDirs: Effect.Effect<void> = Effect.suspend(() =>
  removeDirs(tempDirs.splice(0)),
);

export const withSettings = <A, E>(
  use: (paths: SettingsPaths) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const testDir = yield* makeTempDir("settings-manager-test-");
    tempDirs.push(testDir);
    const agentDir = joinPath(testDir, "agent");
    const projectDir = joinPath(testDir, "project");
    yield* makeDirectory(agentDir);
    yield* makeDirectory(joinPath(projectDir, ".msa"));
    return yield* use({
      agentDir,
      projectDir,
      settingsPath: joinPath(agentDir, "settings.json"),
      projectSettingsPath: joinPath(projectDir, ".msa", "settings.json"),
      openManager: (options) => SettingsManager.create(projectDir, agentDir, options),
    });
  });

export const readSettings = (file: string): Effect.Effect<any> =>
  readJsonFile(file) as Effect.Effect<any>;
