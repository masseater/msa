import testing from "@msa/testing";
import { Effect } from "effect";

import { SettingsManager } from "../src/core/settings-manager.ts";
import type settingsManagerSupportTypes from "./settings-manager-support.types.ts";

const { joinPath, makeDirectory, makeTempDir, readJsonFile, removeDirs } = testing;

const tempDirs: string[] = [];

const removeSettingsDirs: Effect.Effect<void> = Effect.suspend(() =>
  removeDirs(tempDirs.splice(0)),
);

const withSettings = <A, E>(
  use: (paths: settingsManagerSupportTypes.SettingsPaths) => Effect.Effect<A, E>,
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
      openManager: (options) => SettingsManager.create(projectDir, agentDir, options),
      projectDir,
      projectSettingsPath: joinPath(projectDir, ".msa", "settings.json"),
      settingsPath: joinPath(agentDir, "settings.json"),
    });
  });

const readSettings = (file: string): Effect.Effect<any> => readJsonFile(file) as Effect.Effect<any>;

const settingsManagerSupport = {
  readSettings,
  removeSettingsDirs,
  withSettings,
};

export default settingsManagerSupport;
