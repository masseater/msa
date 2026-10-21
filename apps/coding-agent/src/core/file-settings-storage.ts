import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import config from "../config.ts";
import pathsModule from "../utils/paths.ts";
import awaitingModule from "./awaiting.ts";
import platformModule from "./platform/index.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { resolvePath } = pathsModule;
const { dirname, join } = platformModule;
const { exists, makeDirectory, readText, writeFile } = platformModule.files;
const { CONFIG_DIR_NAME } = config;
const { awaited, awaitingWith } = awaitingModule;

const LOCK_RETRIES = { factor: 1, maxTimeout: 20, minTimeout: 20, retries: 9 };

const lockSettingsFile = (path: string): Promise<() => Promise<void>> =>
  lockfile.lock(path, { realpath: false, retries: LOCK_RETRIES });

export default class FileSettingsStorage implements settingsManagerTypes.SettingsStorage {
  private globalSettingsPath: string;
  private projectSettingsPath: string;

  constructor(cwd: string, agentDir: string) {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    this.globalSettingsPath = join(resolvedAgentDir, "settings.json");
    this.projectSettingsPath = join(resolvedCwd, CONFIG_DIR_NAME, "settings.json");
  }

  withLock(
    scope: settingsManagerTypes.SettingsScope,
    fn: (current: string | undefined) => string | undefined,
  ): Promise<void> {
    const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
    return Effect.runPromise(
      awaitingWith(function* () {
        const fileExists = yield* awaited(exists(path));
        let release: (() => Promise<void>) | undefined;
        try {
          if (fileExists) release = yield* awaited(lockSettingsFile(path));
          const current = fileExists ? yield* awaited(readText(path)) : undefined;
          const next = fn(current);
          if (next === undefined) return;
          yield* awaited(makeDirectory({ path: dirname(path) }));
          release ??= yield* awaited(lockSettingsFile(path));
          yield* awaited(writeFile({ data: next, path }));
        } finally {
          if (release !== undefined) yield* awaited(release());
        }
      }, this),
    );
  }
}
