import chalk from "chalk";

import argsModule from "../cli/args.ts";
import type argsTypes from "../cli/args.types.ts";
import platform from "../core/platform/index.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import timings from "../core/timings.ts";
import sessionCwdCheck from "./session-cwd-check.ts";
import sessionLocation from "./session-location.ts";
import sessionTrustModule from "./session-trust.ts";

const { normalizeSessionName } = argsModule;
const { writeError } = platform;
const { time } = timings;
const { sessionTrust } = sessionTrustModule;
const { ensureSessionCwd } = sessionCwdCheck;
const { openSessionManager } = sessionLocation;

function* prepareSession(
  parsed: argsTypes.Args,
  startupSettingsManager: settingsManagerTypes.SettingsManager,
  cwd: string,
  appMode: string,
  agentDir: string,
) {
  const opened = yield* openSessionManager(parsed, startupSettingsManager, cwd);
  const sessionManager = yield* ensureSessionCwd(
    opened.sessionManager,
    cwd,
    appMode,
    opened.sessionDir,
    startupSettingsManager,
  );
  if (parsed.name !== undefined) {
    const name = normalizeSessionName(parsed.name);
    if (name === undefined) {
      writeError(chalk.red("Error: --name requires a non-empty value"));
      process.exit(1);
    }
    sessionManager.appendSessionInfo(name);
  }
  time("createSessionManager");

  const { autoTrustOnReloadCwd, trustStore } = yield* sessionTrust(
    parsed,
    agentDir,
    sessionManager.getCwd(),
  );
  return { autoTrustOnReloadCwd, sessionManager, trustStore };
}

const sessionSetup = { prepareSession };

export default sessionSetup;
