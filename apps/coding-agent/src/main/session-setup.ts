import chalk from "chalk";

import argsModule from "../cli/args.ts";
import type argsTypes from "../cli/args.types.ts";
import platformModule from "../core/platform.ts";
import ProjectTrustStore from "../core/project-trust-store.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import timings from "../core/timings.ts";
import trustManager from "../core/trust-manager.ts";
import sessionCwdCheck from "./session-cwd-check.ts";
import sessionLocation from "./session-location.ts";

const { normalizeSessionName } = argsModule;
const { writeError } = platformModule;
const { time } = timings;
const { hasTrustRequiringProjectResources } = trustManager;
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

  const trustStore = new ProjectTrustStore(agentDir);
  const sessionCwd = sessionManager.getCwd();
  const autoTrustOnReloadCwd =
    parsed.projectTrustOverride === undefined && !hasTrustRequiringProjectResources(sessionCwd)
      ? sessionCwd
      : undefined;
  return { autoTrustOnReloadCwd, sessionManager, trustStore };
}

const sessionSetup = { prepareSession };

export default sessionSetup;
