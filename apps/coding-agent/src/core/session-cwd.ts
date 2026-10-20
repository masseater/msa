import MissingSessionCwdError from "./missing-session-cwd-error.ts";
import nodeFs from "./platform/node/fs.ts";
import type sessionCwdTypes from "./session-cwd.types.ts";

const { existsSync } = nodeFs;

interface SessionCwdSource {
  getCwd(): string;
  getSessionFile(): string | undefined;
}
function getMissingSessionCwdIssue(
  sessionManager: SessionCwdSource,
  fallbackCwd: string,
): sessionCwdTypes.SessionCwdIssue | undefined {
  const sessionFile = sessionManager.getSessionFile();
  if (sessionFile === undefined || sessionFile === "") {
    return undefined;
  }

  const sessionCwd = sessionManager.getCwd();
  if (sessionCwd === "" || existsSync(sessionCwd)) {
    return undefined;
  }

  return {
    fallbackCwd,
    sessionCwd,
    sessionFile,
  };
}
function formatMissingSessionCwdPrompt(issue: sessionCwdTypes.SessionCwdIssue): string {
  return `cwd from session file does not exist\n${issue.sessionCwd}\n\ncontinue in current cwd\n${issue.fallbackCwd}`;
}
function assertSessionCwdExists(sessionManager: SessionCwdSource, fallbackCwd: string): void {
  const issue = getMissingSessionCwdIssue(sessionManager, fallbackCwd);
  if (issue !== undefined) {
    throw new MissingSessionCwdError(issue);
  }
}

const sessionCwd = {
  assertSessionCwdExists,
  formatMissingSessionCwdPrompt,
  getMissingSessionCwdIssue,
};

export default sessionCwd;
