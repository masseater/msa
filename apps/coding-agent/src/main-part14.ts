import chalk from "chalk";

import argsModule from "./cli/args.ts";
import type argsTypes from "./cli/args.types.ts";
import awaitingModule from "./core/awaiting.ts";
import MissingSessionCwdError from "./core/missing-session-cwd-error.ts";
import platformModule from "./core/platform.ts";
import ProjectTrustStore from "./core/project-trust-store.ts";
import sessionCwdModule from "./core/session-cwd.ts";
import SessionManager from "./core/session-manager.ts";
import SettingsManager from "./core/settings-manager.ts";
import timings from "./core/timings.ts";
import trustManager from "./core/trust-manager.ts";
import mainPart11 from "./main-part11.ts";
import mainPart13 from "./main-part13.ts";

const { getMissingSessionCwdIssue } = sessionCwdModule;
const { awaited } = awaitingModule;
const { writeError } = platformModule;
const { normalizeSessionName } = argsModule;
const { time } = timings;
const { hasTrustRequiringProjectResources } = trustManager;
const { mainImplPart1Part1 } = mainPart13;
const { promptForMissingSessionCwd } = mainPart11;

function* mainImplPart1(
  parsed: argsTypes.Args,
  envSessionDir: string | undefined,
  startupSettingsManager: SettingsManager,
  cwd: string,
  appMode: string,
  agentDir: string,
) {
  let { sessionManager, sessionDir } = yield* mainImplPart1Part1(
    parsed,
    envSessionDir,
    startupSettingsManager,
    cwd,
  );
  const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
  if (missingSessionCwdIssue !== undefined) {
    if (appMode === "interactive") {
      const selectedCwd = yield* awaited(
        promptForMissingSessionCwd(missingSessionCwdIssue, startupSettingsManager),
      );
      if (selectedCwd === undefined || selectedCwd === "") {
        process.exit(0);
      }
      sessionManager = SessionManager.open(
        missingSessionCwdIssue.sessionFile!,
        sessionDir,
        selectedCwd,
      );
    } else {
      writeError(chalk.red(new MissingSessionCwdError(missingSessionCwdIssue).message));
      process.exit(1);
    }
  }
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

const mainPart14 = {
  mainImplPart1,
};

export default mainPart14;
