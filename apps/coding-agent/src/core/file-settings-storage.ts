import lockfile from "proper-lockfile";

import config from "../config.ts";
import pathsModule from "../utils/paths.ts";
import platformModule from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { existsSync, mkdirSync, readFileSync, writeFileSync } = nodeFs;
const { resolvePath } = pathsModule;
const { dirname, join, nowMs } = platformModule;
const { CONFIG_DIR_NAME } = config;

export default class FileSettingsStorage implements settingsManagerTypes.SettingsStorage {
  private globalSettingsPath: string;
  private projectSettingsPath: string;

  constructor(cwd: string, agentDir: string) {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    this.globalSettingsPath = join(resolvedAgentDir, "settings.json");
    this.projectSettingsPath = join(resolvedCwd, CONFIG_DIR_NAME, "settings.json");
  }

  private acquireLockSyncWithRetry(path: string): () => void {
    const maxAttempts = 10;
    const delayMs = 20;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return lockfile.lockSync(path, { realpath: false });
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : undefined;
        if (code !== "ELOCKED" || attempt === maxAttempts) {
          throw error;
        }
        lastError = error;
        const start = nowMs();
        while (nowMs() - start < delayMs) {}
      }
    }

    throw (lastError as Error) ?? new Error("Failed to acquire settings lock");
  }

  withLock(
    scope: settingsManagerTypes.SettingsScope,
    fn: (current: string | undefined) => string | undefined,
  ): void {
    const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
    const dir = dirname(path);

    let release: (() => void) | undefined;
    try {
      const fileExists = existsSync(path);
      if (fileExists) {
        release = this.acquireLockSyncWithRetry(path);
      }
      const current = fileExists ? readFileSync(path, "utf-8") : undefined;
      const next = fn(current);
      if (next !== undefined) {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        if (release === undefined) {
          release = this.acquireLockSyncWithRetry(path);
        }
        writeFileSync(path, next, "utf-8");
      }
    } finally {
      if (release !== undefined) {
        release();
      }
    }
  }
}
