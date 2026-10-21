import config from "../../config.ts";
import platform from "../../core/platform/index.ts";
import type sessionManagerTypes from "../../core/session-manager.types.ts";
const { APP_NAME } = config;

function formatCrashExtensionHint(
  extensionMatches: readonly string[] | undefined,
): string | undefined {
  const matches = Array.isArray(extensionMatches)
    ? extensionMatches.filter(
        (match): match is string => typeof match === "string" && match.length > 0,
      )
    : [];
  if (matches.length === 0) return undefined;
  const quoted = matches.map((match) => `\`${match}\``);
  const labels =
    quoted.length === 1
      ? quoted[0]
      : quoted.length === 2
        ? quoted.join(" and ")
        : `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
  const noun = matches.length === 1 ? "extension" : "extensions";
  const pronoun = matches.length === 1 ? "it" : "them";
  return `A stack frame came from loaded ${noun} ${labels}, which may be involved. Try disabling ${pronoun} with \`${APP_NAME} config\`, or run \`${APP_NAME} -ne\` to confirm.`;
}
function quoteIfNeeded(value: string): string {
  if (value.length > 0 && !/[^a-zA-Z0-9_\-./~:@]/u.test(value)) {
    return value;
  }
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}
function formatResumeCommand(
  sessionManager: sessionManagerTypes.SessionManager,
): Promise<string | undefined> {
  if (!process.stdout.isTTY || !sessionManager.isPersisted()) return Promise.resolve(undefined);
  const sessionFile = sessionManager.getSessionFile();
  if (sessionFile === undefined || sessionFile === "") return Promise.resolve(undefined);
  return platform.files
    .exists(sessionFile)
    .then((found) => (found ? resumeCommandFor(sessionManager) : undefined));
}

function resumeCommandFor(sessionManager: sessionManagerTypes.SessionManager): string {
  const args = [APP_NAME];
  if (!sessionManager.usesDefaultSessionDir()) {
    args.push("--session-dir", quoteIfNeeded(sessionManager.getSessionDir()));
  }
  args.push("--session", sessionManager.getSessionId());
  return args.join(" ");
}

const interactiveModeSupport = {
  formatCrashExtensionHint,
  formatResumeCommand,
  quoteIfNeeded,
};

export default interactiveModeSupport;
