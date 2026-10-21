import * as Effect from "effect/Effect";

import agentSessionRuntimeHelpers from "../agent-session-runtime-helpers.ts";
import type AgentSessionRuntime from "../agent-session-runtime.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import platform from "../platform/index.ts";
import SessionManager from "../session-manager.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { exists } = platform.files;
const { extractUserMessageText } = agentSessionRuntimeHelpers;

type ForkOptions = {
  position?: "before" | "at";
  withSession?: (ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>;
};

export default class SessionForking {
  private readonly runtime: AgentSessionRuntime;

  constructor(runtime: AgentSessionRuntime) {
    this.runtime = runtime;
  }

  fork(
    entryId: string,
    options?: ForkOptions,
  ): Promise<{ cancelled: boolean; selectedText?: string | undefined }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const position = options?.position ?? "before";
        const beforeResult = yield* performed(
          this.runtime.replacement.emitBeforeFork(entryId, { position }),
        );
        if (beforeResult.cancelled) {
          return { cancelled: true };
        }
        const { targetLeafId, selectedText } = this.forkTarget(entryId, position);
        const previousSessionFile = this.runtime.session.sessionFile;
        const { sessionManager, prepare } = yield* awaited(this.forkedSessionManager(targetLeafId));
        const persistedBranch =
          this.runtime.session.sessionManager.isPersisted() &&
          targetLeafId !== null &&
          targetLeafId !== "";
        yield* performed(
          this.runtime.replacement.replace(
            "fork",
            sessionManager,
            previousSessionFile,
            persistedBranch
              ? { cwd: sessionManager.getCwd(), withSession: options?.withSession }
              : { prepare, withSession: options?.withSession },
          ),
        );
        return { cancelled: false, selectedText };
      }, this),
    );
  }

  private forkTarget(
    entryId: string,
    position: "before" | "at",
  ): { targetLeafId: string | null; selectedText: string | undefined } {
    const selectedEntry = this.runtime.session.sessionManager.getEntry(entryId);
    if (selectedEntry === undefined) {
      throw new Error("Invalid entry ID for forking");
    }
    if (position === "at") {
      return { selectedText: undefined, targetLeafId: selectedEntry.id };
    }
    if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
      throw new Error("Invalid entry ID for forking");
    }
    return {
      selectedText: extractUserMessageText(selectedEntry.message.content),
      targetLeafId: selectedEntry.parentId,
    };
  }

  private forkedSessionManager(targetLeafId: string | null): Promise<{
    sessionManager: SessionManager;
    prepare?: () => void;
  }> {
    const current = this.runtime.session.sessionManager;
    const hasTarget = targetLeafId !== null && targetLeafId !== "";
    if (!current.isPersisted()) {
      const parentSession = this.runtime.session.sessionFile;
      return Promise.resolve({
        prepare: () => {
          if (hasTarget) current.createBranchedSession(targetLeafId);
          else current.newSession({ parentSession });
        },
        sessionManager: current,
      });
    }
    return this.persistedForkedSessionManager(targetLeafId);
  }

  private persistedForkedSessionManager(
    targetLeafId: string | null,
  ): Promise<{ sessionManager: SessionManager }> {
    const current = this.runtime.session.sessionManager;
    const currentSessionFile = this.runtime.session.sessionFile;
    if (currentSessionFile === undefined || currentSessionFile === "") {
      throw new Error("Persisted session is missing a session file");
    }
    const sessionDir = current.getSessionDir();
    if (targetLeafId === null || targetLeafId === "") {
      const sessionManager = SessionManager.create(this.runtime.cwd, sessionDir);
      sessionManager.newSession({ parentSession: currentSessionFile });
      return Promise.resolve({ sessionManager });
    }
    return exists(currentSessionFile)
      .then((found) => {
        if (!found) {
          throw new Error(
            "This session has not been saved yet. Send a message before cloning or forking it.",
          );
        }
        return SessionManager.open(currentSessionFile, sessionDir);
      })
      .then((sessionManager) => {
        const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
        if (forkedSessionPath === undefined || forkedSessionPath === "") {
          throw new Error("Failed to create forked session");
        }
        return { sessionManager };
      });
  }
}
