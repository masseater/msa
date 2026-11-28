import testing from "@msa/testing";
import { Array as Arr, Effect } from "effect";
import { expect, it } from "vite-plus/test";

import SettingsManager from "../src/core/settings-manager.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import type settingsManagerSupportTypes from "./settings-manager-support.types.ts";
const { joinPath, makeDirectory, makeTempDir, readJsonFile, removeDirs, writeJsonFile } = testing;

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
      openManager: (options) =>
        Effect.promise(() => SettingsManager.create(projectDir, agentDir, options)),
      projectDir,
      projectSettingsPath: joinPath(projectDir, ".msa", "settings.json"),
      settingsPath: joinPath(agentDir, "settings.json"),
    });
  });

const readingFrom =
  (files: settingsManagerSupportTypes.SettingsFiles) =>
  <A>(read: (manager: settingsManagerTypes.SettingsManager) => A): Effect.Effect<A> =>
    withSettings(({ settingsPath, projectSettingsPath, openManager }) =>
      Effect.gen(function* () {
        if (files.global !== undefined) {
          yield* writeJsonFile(settingsPath, files.global);
        }
        if (files.project !== undefined) {
          yield* writeJsonFile(projectSettingsPath, files.project);
        }
        return read(yield* openManager());
      }),
    );

type ReadRow<A> = readonly [
  name: string,
  files: settingsManagerSupportTypes.SettingsFiles,
  expected: A,
];

const settingsRead = <A>(
  read: (manager: settingsManagerTypes.SettingsManager) => A,
  rows: readonly ReadRow<A>[],
): void =>
  Arr.forEach(rows, ([name, files, expected]) => {
    it(name, () =>
      testing.runTest(
        Effect.map(readingFrom(files)(read), (found) => {
          expect(found).toStrictEqual(expected);
        }),
      ),
    );
  });

const readSettings = (file: string): Effect.Effect<any> => readJsonFile(file) as Effect.Effect<any>;

const settingsManagerSupport = {
  readSettings,
  readingFrom,
  removeSettingsDirs,
  settingsRead,
  withSettings,
};

export default settingsManagerSupport;
