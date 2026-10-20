import chalk from "chalk";
import { Effect } from "effect";

import type argsTypes from "./cli/args.types.ts";
import awaitingModule from "./core/awaiting.ts";
import platformModule from "./core/platform.ts";
import SessionManager from "./core/session-manager.ts";
import type sessionManagerTypes from "./core/session-manager.types.ts";
import type settingsManagerTypes from "./core/settings-manager.types.ts";
import mainPart4 from "./main-part4.ts";
import mainPart5 from "./main-part5.ts";
import mainPart6 from "./main-part6.ts";
import themeModule from "./modes/interactive/theme/theme.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError, writeLog } = platformModule;
const { stopThemeWatcher } = themeModule;
const { findLocalSessionByExactId, resolveSessionPath } = mainPart4;
const { createSessionManagerImplPart1, forkSessionOrExit, openSessionOrExit } = mainPart6;
const { promptConfirm } = mainPart5;

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
          return yield* createSessionManagerImplPart1(cwd, sessionDir, settingsManager);
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

const mainPart7 = {
  createSessionManagerImpl,
};

export default mainPart7;
