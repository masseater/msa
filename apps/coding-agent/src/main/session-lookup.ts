import { createInterface } from "node:readline";

import { Effect } from "effect";

import awaitingModule from "../core/awaiting.ts";
import SessionManager from "../core/session-manager.ts";
import type mainInternalTypes from "../main-internal.types.ts";
import interop from "../utils/interop.ts";
import pathsModule from "../utils/paths.ts";

const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { resolvePath } = pathsModule;

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

const sessionLookup = { findLocalSessionByExactId, promptConfirm, resolveSessionPath };

export default sessionLookup;
