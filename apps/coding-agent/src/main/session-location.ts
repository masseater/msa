import type argsTypes from "../cli/args.types.ts";
import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform/index.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import pathsModule from "../utils/paths.ts";
import sessionOpen from "./session-open.ts";

const { expandTildePath, ENV_SESSION_DIR } = config;
const { awaited } = awaitingModule;
const { readEnv } = platform;
const { normalizePath } = pathsModule;
const { createSessionManager } = sessionOpen;

function sessionDirFor(
  parsed: argsTypes.Args,
  settingsManager: settingsManagerTypes.SettingsManager,
): string | undefined {
  const envSessionDir = readEnv(ENV_SESSION_DIR);
  return (
    (parsed.sessionDir !== undefined && parsed.sessionDir !== ""
      ? normalizePath(parsed.sessionDir)
      : undefined) ??
    (envSessionDir !== undefined && envSessionDir !== ""
      ? expandTildePath(envSessionDir)
      : undefined) ??
    settingsManager.session.getSessionDir()
  );
}

function* openSessionManager(
  parsed: argsTypes.Args,
  settingsManager: settingsManagerTypes.SettingsManager,
  cwd: string,
) {
  const sessionDir = sessionDirFor(parsed, settingsManager);
  const sessionManager = yield* awaited(
    createSessionManager(parsed, cwd, sessionDir, settingsManager),
  );
  return { sessionDir, sessionManager };
}

const sessionLocation = { openSessionManager };

export default sessionLocation;
