import chalk from "chalk";

import sessionPicker from "../cli/session-picker.ts";
import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform/index.ts";
import SessionManager from "../core/session-manager.ts";
import type sessionManagerTypes from "../core/session-manager.types.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import errorsModule from "../utils/errors.ts";
import sessionLookup from "./session-lookup.ts";

const { awaited } = awaitingModule;
const { writeError, writeLog } = platform;
const { selectSession } = sessionPicker;
const { stopThemeWatcher } = themeModule;
const { toErrorMessage } = errorsModule;
const { findLocalSessionByExactId, promptConfirm, resolveSessionPath } = sessionLookup;

function exitWithError(error: unknown): never {
  writeError(chalk.red(`Error: ${toErrorMessage(error)}`));
  process.exit(1);
}

function openSessionOrExit(
  path: string,
  sessionDir?: string,
): Promise<sessionManagerTypes.SessionManager> {
  return SessionManager.open(path, sessionDir).catch(exitWithError);
}

function forkSessionOrExit(
  sourcePath: string,
  cwd: string,
  sessionDir?: string,
  sessionId?: string,
): Promise<sessionManagerTypes.SessionManager> {
  return SessionManager.forkFrom(sourcePath, cwd, sessionDir, { id: sessionId }).catch(
    exitWithError,
  );
}

function* forkFromArg(
  forkArg: string,
  sessionId: string | undefined,
  cwd: string,
  sessionDir: string | undefined,
) {
  if (sessionId !== undefined && sessionId !== "") {
    const existingTarget = yield* awaited(findLocalSessionByExactId(sessionId, cwd, sessionDir));
    if (existingTarget !== undefined) {
      writeError(chalk.red(`Session already exists with id '${sessionId}'`));
      process.exit(1);
    }
  }

  const resolved = yield* awaited(resolveSessionPath(forkArg, cwd, sessionDir));

  switch (resolved.type) {
    case "path":
    case "local":
    case "global":
      return yield* awaited(forkSessionOrExit(resolved.path, cwd, sessionDir, sessionId));

    case "not_found":
      writeError(chalk.red(`No session found matching '${resolved.arg}'`));
      process.exit(1);
  }
}

function* openFromArg(sessionArg: string, cwd: string, sessionDir: string | undefined) {
  const resolved = yield* awaited(resolveSessionPath(sessionArg, cwd, sessionDir));

  switch (resolved.type) {
    case "path":
    case "local":
      return yield* awaited(openSessionOrExit(resolved.path, sessionDir));

    case "global": {
      writeLog(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
      const shouldFork = yield* awaited(promptConfirm("Fork this session into current directory?"));
      if (!shouldFork) {
        writeLog(chalk.dim("Aborted."));
        process.exit(0);
      }
      return yield* awaited(forkSessionOrExit(resolved.path, cwd, sessionDir));
    }

    case "not_found":
      writeError(chalk.red(`No session found matching '${resolved.arg}'`));
      process.exit(1);
  }
}

function* pickSessionToResume(
  cwd: string,
  sessionDir: string | undefined,
  settingsManager: settingsManagerTypes.SettingsManager,
) {
  try {
    const selectedPath = yield* awaited(
      selectSession(
        (onProgress, signal) => SessionManager.list(cwd, sessionDir, onProgress, signal),
        (onProgress, signal) => SessionManager.listAll(sessionDir, onProgress, signal),
        settingsManager,
      ),
    );
    if (selectedPath === null || selectedPath === "") {
      writeLog(chalk.dim("No session selected"));
      process.exit(0);
    }
    return yield* awaited(SessionManager.open(selectedPath, sessionDir));
  } finally {
    stopThemeWatcher();
  }
}

function openOrCreateWithId(
  sessionId: string | undefined,
  cwd: string,
  sessionDir: string | undefined,
): Promise<sessionManagerTypes.SessionManager> {
  if (sessionId === undefined || sessionId === "") {
    return Promise.resolve(SessionManager.create(cwd, sessionDir, { id: sessionId }));
  }
  return findLocalSessionByExactId(sessionId, cwd, sessionDir).then((existingSession) => {
    if (existingSession !== undefined) {
      return SessionManager.open(existingSession.path, sessionDir);
    }
    writeError(
      chalk.yellow(
        `Warning: No project session found with id '${sessionId}'; creating a new session with that id.`,
      ),
    );
    return SessionManager.create(cwd, sessionDir, { id: sessionId });
  });
}

const sessionSources = { forkFromArg, openFromArg, openOrCreateWithId, pickSessionToResume };

export default sessionSources;
