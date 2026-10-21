import { createInterface } from "node:readline";

import chalk from "chalk";
import { Effect } from "effect";
import { dual } from "effect/Function";

import argsModule from "../cli/args.ts";
import type argsTypes from "../cli/args.types.ts";
import sessionPicker from "../cli/session-picker.ts";
import startupUi from "../cli/startup-ui.ts";
import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import MissingSessionCwdError from "../core/missing-session-cwd-error.ts";
import platformModule from "../core/platform.ts";
import ProjectTrustStore from "../core/project-trust-store.ts";
import sessionCwdModule from "../core/session-cwd.ts";
import type sessionCwdTypes from "../core/session-cwd.types.ts";
import SessionManager from "../core/session-manager.ts";
import type sessionManagerTypes from "../core/session-manager.types.ts";
import sessionFormat from "../core/session-manager/session-format.ts";
import SettingsManager from "../core/settings-manager.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import timings from "../core/timings.ts";
import trustManager from "../core/trust-manager.ts";
import type mainInternalTypes from "../main-internal.types.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import errorsModule from "../utils/errors.ts";
import interop from "../utils/interop.ts";
import pathsModule from "../utils/paths.ts";

const { hasTrustRequiringProjectResources } = trustManager;
const { time } = timings;
const { normalizeSessionName } = argsModule;
const { getMissingSessionCwdIssue, formatMissingSessionCwdPrompt } = sessionCwdModule;
const { expandTildePath } = config;
const { normalizePath, resolvePath } = pathsModule;
const { showStartupSelector } = startupUi;
const { stopThemeWatcher } = themeModule;
const { writeLog, writeError } = platformModule;
const { selectSession } = sessionPicker;
const { toErrorMessage } = errorsModule;
const { assertValidSessionId } = sessionFormat;
const { callbackPromise } = interop;
const { awaited, awaiting } = awaitingModule;

function findLocalSessionByExactId(
  sessionId: string,
  cwd: string,
  sessionDir?: string,
): { type: "local"; path: string } | undefined {
  const path = SessionManager.findById(cwd, sessionId, sessionDir);
  return path !== undefined && path !== "" ? { path, type: "local" } : undefined;
}

function resolveSessionPath(
  sessionArg: string,
  cwd: string,
  sessionDir?: string,
): Promise<mainInternalTypes.ResolvedSession> {
  return Effect.runPromise(
    awaiting(function* () {
      if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
        return { path: resolvePath(sessionArg, cwd), type: "path" };
      }

      const exactLocalMatch = findLocalSessionByExactId(sessionArg, cwd, sessionDir);
      if (exactLocalMatch !== undefined) {
        return exactLocalMatch;
      }

      const localSessions = yield* awaited(SessionManager.list(cwd, sessionDir));
      const localMatch = localSessions.find((s) => s.id.startsWith(sessionArg));

      if (localMatch !== undefined) {
        return { path: localMatch.path, type: "local" };
      }

      const allSessions = yield* awaited(SessionManager.listAll(sessionDir));
      const globalMatch =
        allSessions.find((s) => s.id === sessionArg) ??
        allSessions.find((s) => s.id.startsWith(sessionArg));

      if (globalMatch !== undefined) {
        return { cwd: globalMatch.cwd, path: globalMatch.path, type: "global" };
      }

      return { arg: sessionArg, type: "not_found" };
    }),
  );
}

function promptConfirm(message: string): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        callbackPromise((resolve) => {
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question(`${message} [y/N] `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
          });
        }),
      );
    }),
  );
}

function validateForkFlags(parsed: argsTypes.Args): void {
  if (parsed.fork === undefined || parsed.fork === "") return;

  const conflictingFlags = [
    parsed.session !== undefined && parsed.session !== "" ? "--session" : undefined,
    parsed.continue === true ? "--continue" : undefined,
    parsed.resume === true ? "--resume" : undefined,
    parsed.noSession === true ? "--no-session" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflictingFlags.length > 0) {
    writeError(chalk.red(`Error: --fork cannot be combined with ${conflictingFlags.join(", ")}`));
    process.exit(1);
  }
}

function validateSessionIdFlags(parsed: argsTypes.Args): void {
  if (parsed.sessionId === undefined) return;

  const conflictingFlags = [
    parsed.session !== undefined && parsed.session !== "" ? "--session" : undefined,
    parsed.continue === true ? "--continue" : undefined,
    parsed.resume === true ? "--resume" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflictingFlags.length > 0) {
    writeError(
      chalk.red(`Error: --session-id cannot be combined with ${conflictingFlags.join(", ")}`),
    );
    process.exit(1);
  }

  try {
    assertValidSessionId(parsed.sessionId);
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    writeError(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

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

function* pickSessionToResume(
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

function createSessionManagerImpl(
  parsed: argsTypes.Args,
  cwd: string,
  sessionDir: string | undefined,
  settingsManager: settingsManagerTypes.SettingsManager,
): Promise<sessionManagerTypes.SessionManager> {
  return Effect.runPromise(
    awaiting(function* () {
      if (parsed.noSession === true || parsed.help === true || parsed.listModels !== undefined) {
        return SessionManager.inMemory(
          cwd,
          parsed.sessionId === undefined ? undefined : { id: parsed.sessionId },
        );
      }

      if (parsed.fork !== undefined && parsed.fork !== "") {
        if (parsed.sessionId !== undefined && parsed.sessionId !== "") {
          const existingTarget = findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
          if (existingTarget !== undefined) {
            writeError(chalk.red(`Session already exists with id '${parsed.sessionId}'`));
            process.exit(1);
          }
        }

        const resolved = yield* awaited(resolveSessionPath(parsed.fork, cwd, sessionDir));

        switch (resolved.type) {
          case "path":
          case "local":
          case "global":
            return forkSessionOrExit(resolved.path, cwd, sessionDir, parsed.sessionId);

          case "not_found":
            writeError(chalk.red(`No session found matching '${resolved.arg}'`));
            process.exit(1);
        }
      }

      if (parsed.session !== undefined && parsed.session !== "") {
        const resolved = yield* awaited(resolveSessionPath(parsed.session, cwd, sessionDir));

        switch (resolved.type) {
          case "path":
          case "local":
            return openSessionOrExit(resolved.path, sessionDir);

          case "global": {
            writeLog(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
            const shouldFork = yield* awaited(
              promptConfirm("Fork this session into current directory?"),
            );
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

      if (parsed.resume === true) {
        try {
          return yield* pickSessionToResume(cwd, sessionDir, settingsManager);
        } finally {
          stopThemeWatcher();
        }
      }

      if (parsed.continue === true) {
        return SessionManager.continueRecent(cwd, sessionDir);
      }

      if (parsed.sessionId !== undefined && parsed.sessionId !== "") {
        const existingSession = findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
        if (existingSession !== undefined) {
          return SessionManager.open(existingSession.path, sessionDir);
        }
        writeError(
          chalk.yellow(
            `Warning: No project session found with id '${parsed.sessionId}'; creating a new session with that id.`,
          ),
        );
      }

      return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId });
    }),
  );
}

const createSessionManager: {
  (
    parsed: argsTypes.Args,
    cwd: string,
    sessionDir: string | undefined,
    settingsManager: settingsManagerTypes.SettingsManager,
  ): Promise<sessionManagerTypes.SessionManager>;
  (
    cwd: string,
    sessionDir: string | undefined,
    settingsManager: settingsManagerTypes.SettingsManager,
  ): (parsed: argsTypes.Args) => Promise<sessionManagerTypes.SessionManager>;
} = dual((args: IArguments) => args.length >= 4, createSessionManagerImpl);

function promptForMissingSessionCwd(
  issue: sessionCwdTypes.SessionCwdIssue,
  settingsManager: settingsManagerTypes.SettingsManager,
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        showStartupSelector(settingsManager, formatMissingSessionCwdPrompt(issue), [
          { label: "Continue", value: issue.fallbackCwd },
          { label: "Cancel", value: undefined },
        ]),
      );
    }),
  );
}

function* openSessionManager(
  parsed: argsTypes.Args,
  envSessionDir: string | undefined,
  startupSettingsManager: SettingsManager,
  cwd: string,
) {
  const sessionDir =
    (parsed.sessionDir !== undefined && parsed.sessionDir !== ""
      ? normalizePath(parsed.sessionDir)
      : undefined) ??
    (envSessionDir !== undefined && envSessionDir !== ""
      ? expandTildePath(envSessionDir)
      : undefined) ??
    startupSettingsManager.session.getSessionDir();
  let sessionManager = yield* awaited(
    createSessionManager(parsed, cwd, sessionDir, startupSettingsManager),
  );
  return { sessionDir, sessionManager };
}

function* prepareSession(
  parsed: argsTypes.Args,
  envSessionDir: string | undefined,
  startupSettingsManager: SettingsManager,
  cwd: string,
  appMode: string,
  agentDir: string,
) {
  let { sessionManager, sessionDir } = yield* openSessionManager(
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

const sessionSetup = {
  createSessionManager,
  prepareSession,
  validateForkFlags,
  validateSessionIdFlags,
};

export default sessionSetup;
