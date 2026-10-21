import { Effect } from "effect";
import { dual } from "effect/Function";

import type argsTypes from "../cli/args.types.ts";
import awaitingModule from "../core/awaiting.ts";
import SessionManager from "../core/session-manager.ts";
import type sessionManagerTypes from "../core/session-manager.types.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import sessionSources from "./session-sources.ts";

const { awaited, awaiting } = awaitingModule;
const { forkFromArg, openFromArg, openOrCreateWithId, pickSessionToResume } = sessionSources;

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
        return yield* forkFromArg(parsed.fork, parsed.sessionId, cwd, sessionDir);
      }
      if (parsed.session !== undefined && parsed.session !== "") {
        return yield* openFromArg(parsed.session, cwd, sessionDir);
      }
      if (parsed.resume === true) {
        return yield* pickSessionToResume(cwd, sessionDir, settingsManager);
      }
      if (parsed.continue === true) {
        return yield* awaited(SessionManager.continueRecent(cwd, sessionDir));
      }
      return yield* awaited(openOrCreateWithId(parsed.sessionId, cwd, sessionDir));
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

const sessionOpen = { createSessionManager };

export default sessionOpen;
