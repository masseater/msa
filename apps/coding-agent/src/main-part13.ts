import type argsTypes from "./cli/args.types.ts";
import config from "./config.ts";
import awaitingModule from "./core/awaiting.ts";
import SettingsManager from "./core/settings-manager.ts";
import mainPart8 from "./main-part8.ts";
import pathsModule from "./utils/paths.ts";

const { normalizePath } = pathsModule;
const { expandTildePath } = config;
const { awaited } = awaitingModule;
const { createSessionManager } = mainPart8;

function* mainImplPart1Part1(
  parsed: argsTypes.Args,
  envSessionDir: string | undefined,
  startupSettingsManager: SettingsManager,
  cwd: string,
) {
  const sessionDir =
    (parsed.sessionDir !== undefined && parsed.sessionDir !== ""
      ? normalizePath(parsed.sessionDir)
      : undefined) ??
    (envSessionDir !== undefined && envSessionDir !== ""
      ? expandTildePath(envSessionDir)
      : undefined) ??
    startupSettingsManager.session.getSessionDir();
  let sessionManager = yield* awaited(
    createSessionManager(parsed, cwd, sessionDir, startupSettingsManager),
  );
  return { sessionDir, sessionManager };
}

const mainPart13 = {
  mainImplPart1Part1,
};

export default mainPart13;
