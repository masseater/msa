import chalk from "chalk";

import startupUi from "../cli/startup-ui.ts";
import awaitingModule from "../core/awaiting.ts";
import MissingSessionCwdError from "../core/missing-session-cwd-error.ts";
import platform from "../core/platform/index.ts";
import sessionCwdModule from "../core/session-cwd.ts";
import SessionManager from "../core/session-manager.ts";
import type sessionManagerTypes from "../core/session-manager.types.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";

const { showStartupSelector } = startupUi;
const { awaited } = awaitingModule;
const { writeError } = platform;
const { getMissingSessionCwdIssue, formatMissingSessionCwdPrompt } = sessionCwdModule;

function* ensureSessionCwd(
  sessionManager: sessionManagerTypes.SessionManager,
  cwd: string,
  appMode: string,
  sessionDir: string | undefined,
  settingsManager: settingsManagerTypes.SettingsManager,
) {
  const issue = getMissingSessionCwdIssue(sessionManager, cwd);
  if (issue === undefined) return sessionManager;
  if (appMode !== "interactive") {
    writeError(chalk.red(new MissingSessionCwdError(issue).message));
    process.exit(1);
  }
  const selectedCwd = yield* awaited(
    showStartupSelector(settingsManager, formatMissingSessionCwdPrompt(issue), [
      { label: "Continue", value: issue.fallbackCwd },
      { label: "Cancel", value: undefined },
    ]),
  );
  if (selectedCwd === undefined || selectedCwd === "") {
    process.exit(0);
  }
  return SessionManager.open(issue.sessionFile!, sessionDir, selectedCwd);
}

const sessionCwdCheck = { ensureSessionCwd };

export default sessionCwdCheck;
