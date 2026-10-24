import MissingSessionCwdError from "./missing-session-cwd-error.ts";
import platform from "./platform/index.ts";
import type sessionCwdTypes from "./session-cwd.types.ts";

const { exists } = platform.files;

interface SessionCwdSource {
  getCwd(): string;
  getSessionFile(): string | undefined;
}
function getMissingSessionCwdIssue(
  sessionManager: SessionCwdSource,
  fallbackCwd: string,
): Promise<sessionCwdTypes.SessionCwdIssue | undefined> {
  const sessionFile = sessionManager.getSessionFile();
  const sessionCwd = sessionManager.getCwd();
  if (sessionFile === undefined || sessionFile === "" || sessionCwd === "") {
    return Promise.resolve(undefined);
  }
  return exists(sessionCwd).then((found) =>
    found ? undefined : { fallbackCwd, sessionCwd, sessionFile },
  );
}
function formatMissingSessionCwdPrompt(issue: sessionCwdTypes.SessionCwdIssue): string {
  return `cwd from session file does not exist\n${issue.sessionCwd}\n\ncontinue in current cwd\n${issue.fallbackCwd}`;
}
function assertSessionCwdExists(
  sessionManager: SessionCwdSource,
  fallbackCwd: string,
): Promise<void> {
  return getMissingSessionCwdIssue(sessionManager, fallbackCwd).then((issue) => {
    if (issue !== undefined) {
      throw MissingSessionCwdError.create(issue);
    }
    return undefined;
  });
}

const sessionCwd = {
  assertSessionCwdExists,
  formatMissingSessionCwdPrompt,
  getMissingSessionCwdIssue,
};

export default sessionCwd;
