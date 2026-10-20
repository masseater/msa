import * as Effect from "effect/Effect";

import agentSessionRuntimeHelpers from "./agent-session-runtime-helpers.ts";
import AgentSessionRuntimeLayer1 from "./agent-session-runtime-layer-1.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import nodeFs from "./platform/node/fs.ts";
import SessionManager from "./session-manager.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { existsSync } = nodeFs;
const { extractUserMessageText } = agentSessionRuntimeHelpers;

export default abstract class AgentSessionRuntimeLayer2 extends AgentSessionRuntimeLayer1 {
  newSession(options?: {
    parentSession?: string;
    setup?: (sessionManager: sessionManagerTypes.SessionManager) => Promise<void>;
    withSession?: (ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>;
  }): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const beforeResult = yield* performed(this.emitBeforeSwitch("new"));
        if (beforeResult.cancelled) {
          return beforeResult;
        }

        const previousSessionFile = this.session.sessionFile;
        const sessionDir = this.session.sessionManager.getSessionDir();
        const sessionManager = this.session.sessionManager.isPersisted()
          ? SessionManager.create(this.cwd, sessionDir)
          : SessionManager.inMemory(this.cwd);
        if (options?.parentSession !== undefined && options?.parentSession !== "") {
          sessionManager.newSession({ parentSession: options.parentSession });
        }

        yield* performed(this.teardownCurrent("new", sessionManager.getSessionFile()));
        this.apply(
          yield* awaited(
            this.createRuntime({
              agentDir: this.services.agentDir,
              cwd: this.cwd,
              sessionManager,
              sessionStartEvent: { previousSessionFile, reason: "new", type: "session_start" },
            }),
          ),
        );
        if (options?.setup !== undefined) {
          yield* awaited(options.setup(this.session.sessionManager));
          this.session.refreshContext();
        }
        yield* performed(this.finishSessionReplacement(options?.withSession));
        return { cancelled: false };
      }, this),
    );
  }

  fork(
    entryId: string,
    options?: {
      position?: "before" | "at";
      withSession?: (ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>;
    },
  ): Promise<{ cancelled: boolean; selectedText?: string | undefined }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const position = options?.position ?? "before";
        const beforeResult = yield* performed(this.emitBeforeFork(entryId, { position }));
        if (beforeResult.cancelled) {
          return { cancelled: true };
        }
        let targetLeafId: string | null;
        let selectedText: string | undefined;

        const selectedEntry = this.session.sessionManager.getEntry(entryId);
        if (selectedEntry === undefined) {
          throw new Error("Invalid entry ID for forking");
        }

        if (position === "at") {
          targetLeafId = selectedEntry.id;
        } else {
          if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
            throw new Error("Invalid entry ID for forking");
          }
          targetLeafId = selectedEntry.parentId;
          selectedText = extractUserMessageText(selectedEntry.message.content);
        }

        const previousSessionFile = this.session.sessionFile;
        if (this.session.sessionManager.isPersisted()) {
          const currentSessionFile = this.session.sessionFile;
          if (currentSessionFile === undefined || currentSessionFile === "") {
            throw new Error("Persisted session is missing a session file");
          }
          const sessionDir = this.session.sessionManager.getSessionDir();
          if (targetLeafId === null || targetLeafId === "") {
            const sessionManager = SessionManager.create(this.cwd, sessionDir);
            sessionManager.newSession({ parentSession: currentSessionFile });
            yield* performed(this.teardownCurrent("fork", sessionManager.getSessionFile()));
            this.apply(
              yield* awaited(
                this.createRuntime({
                  agentDir: this.services.agentDir,
                  cwd: this.cwd,
                  sessionManager,
                  sessionStartEvent: { previousSessionFile, reason: "fork", type: "session_start" },
                }),
              ),
            );
            yield* performed(this.finishSessionReplacement(options?.withSession));
            return { cancelled: false, selectedText };
          }

          return yield* this.forkPart1(
            currentSessionFile,
            sessionDir,
            targetLeafId,
            previousSessionFile,
            options,
            selectedText,
          );
        }

        const sessionManager = this.session.sessionManager;
        yield* performed(this.teardownCurrent("fork", sessionManager.getSessionFile()));
        if (targetLeafId === null || targetLeafId === "") {
          sessionManager.newSession({ parentSession: previousSessionFile });
        } else {
          sessionManager.createBranchedSession(targetLeafId);
        }
        this.apply(
          yield* awaited(
            this.createRuntime({
              agentDir: this.services.agentDir,
              cwd: this.cwd,
              sessionManager,
              sessionStartEvent: { previousSessionFile, reason: "fork", type: "session_start" },
            }),
          ),
        );
        yield* performed(this.finishSessionReplacement(options?.withSession));
        return { cancelled: false, selectedText };
      }, this),
    );
  }

  protected *forkPart1(
    currentSessionFile: string,
    sessionDir: string,
    targetLeafId: string,
    previousSessionFile: string | undefined,
    options:
      | {
          position?: "before" | "at";
          withSession?: (ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>;
        }
      | undefined,
    selectedText: string | undefined,
  ) {
    if (!existsSync(currentSessionFile)) {
      throw new Error(
        "This session has not been saved yet. Send a message before cloning or forking it.",
      );
    }
    const sessionManager = SessionManager.open(currentSessionFile, sessionDir);
    const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
    if (forkedSessionPath === undefined || forkedSessionPath === "") {
      throw new Error("Failed to create forked session");
    }
    yield* performed(this.teardownCurrent("fork", sessionManager.getSessionFile()));
    this.apply(
      yield* awaited(
        this.createRuntime({
          agentDir: this.services.agentDir,
          cwd: sessionManager.getCwd(),
          sessionManager,
          sessionStartEvent: { previousSessionFile, reason: "fork", type: "session_start" },
        }),
      ),
    );
    yield* performed(this.finishSessionReplacement(options?.withSession));
    return { cancelled: false, selectedText };
  }
}
