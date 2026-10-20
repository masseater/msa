import chalk from "chalk";

import sessionPicker from "./cli/session-picker.ts";
import awaitingModule from "./core/awaiting.ts";
import platformModule from "./core/platform.ts";
import SessionManager from "./core/session-manager.ts";
import type sessionManagerTypes from "./core/session-manager.types.ts";
import SettingsManager from "./core/settings-manager.ts";
import errorsModule from "./utils/errors.ts";

const { toErrorMessage } = errorsModule;
const { writeError, writeLog } = platformModule;
const { awaited } = awaitingModule;
const { selectSession } = sessionPicker;

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

function* createSessionManagerImplPart1(
  cwd: string,
  sessionDir: string | undefined,
  settingsManager: SettingsManager,
) {
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
}

const mainPart6 = {
  createSessionManagerImplPart1,
  forkSessionOrExit,
  openSessionOrExit,
};

export default mainPart6;
