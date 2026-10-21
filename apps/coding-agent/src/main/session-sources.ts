import chalk from "chalk";

import sessionPicker from "../cli/session-picker.ts";
import awaitingModule from "../core/awaiting.ts";
import platformModule from "../core/platform.ts";
import SessionManager from "../core/session-manager.ts";
import type sessionManagerTypes from "../core/session-manager.types.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import errorsModule from "../utils/errors.ts";
import sessionLookup from "./session-lookup.ts";

const { awaited } = awaitingModule;
const { writeLog, writeError } = platformModule;
const { selectSession } = sessionPicker;
const { stopThemeWatcher } = themeModule;
const { toErrorMessage } = errorsModule;
const { findLocalSessionByExactId, promptConfirm, resolveSessionPath } = sessionLookup;

function openSessionOrExit(path: string, sessionDir?: string): sessionManagerTypes.SessionManager {
  try {
    return SessionManager.open(path, sessionDir);
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    writeError(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

function forkSessionOrExit(
  sourcePath: string,
  cwd: string,
  sessionDir?: string,
  sessionId?: string,
): sessionManagerTypes.SessionManager {
  try {
    return SessionManager.forkFrom(sourcePath, cwd, sessionDir, { id: sessionId });
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    writeError(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

function* forkFromArg(
  forkArg: string,
  sessionId: string | undefined,
  cwd: string,
  sessionDir: string | undefined,
) {
  if (sessionId !== undefined && sessionId !== "") {
    const existingTarget = findLocalSessionByExactId(sessionId, cwd, sessionDir);
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
      return forkSessionOrExit(resolved.path, cwd, sessionDir, sessionId);

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
      return openSessionOrExit(resolved.path, sessionDir);

    case "global": {
      writeLog(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
      const shouldFork = yield* awaited(promptConfirm("Fork this session into current directory?"));
      if (!shouldFork) {
        writeLog(chalk.dim("Aborted."));
        process.exit(0);
      }
      return forkSessionOrExit(resolved.path, cwd, sessionDir);
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
    return SessionManager.open(selectedPath, sessionDir);
  } finally {
    stopThemeWatcher();
  }
}

function openOrCreateWithId(
  sessionId: string | undefined,
  cwd: string,
  sessionDir: string | undefined,
): sessionManagerTypes.SessionManager {
  if (sessionId !== undefined && sessionId !== "") {
    const existingSession = findLocalSessionByExactId(sessionId, cwd, sessionDir);
    if (existingSession !== undefined) {
      return SessionManager.open(existingSession.path, sessionDir);
    }
    writeError(
      chalk.yellow(
        `Warning: No project session found with id '${sessionId}'; creating a new session with that id.`,
      ),
    );
  }

  return SessionManager.create(cwd, sessionDir, { id: sessionId });
}

const sessionSources = { forkFromArg, openFromArg, openOrCreateWithId, pickSessionToResume };

export default sessionSources;
