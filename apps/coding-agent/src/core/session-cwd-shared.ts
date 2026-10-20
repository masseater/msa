import type sessionCwdTypes from "./session-cwd.types.ts";

function formatMissingSessionCwdError(issue: sessionCwdTypes.SessionCwdIssue): string {
  const sessionFile =
    issue.sessionFile !== undefined && issue.sessionFile !== ""
      ? `\nSession file: ${issue.sessionFile}`
      : "";
  return `Stored session working directory does not exist: ${issue.sessionCwd}${sessionFile}\nCurrent working directory: ${issue.fallbackCwd}`;
}

const sessionCwdShared = {
  formatMissingSessionCwdError,
};

export default sessionCwdShared;
