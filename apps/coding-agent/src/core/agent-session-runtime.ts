import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, parse, resolve } from "node:path";

import * as Effect from "effect/Effect";

import { resolvePath } from "../utils/paths.ts";
import type {
  AgentSessionRuntimeDiagnostic,
  AgentSessionServices,
} from "./agent-session-services.ts";
import type { AgentSession } from "./agent-session.ts";
import { awaited, awaiting, awaitingWith, performed } from "./awaiting.ts";
import type {
  ProjectTrustContext,
  ReplacedSessionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";
import type { CreateAgentSessionResult } from "./sdk.ts";
import { assertSessionCwdExists } from "./session-cwd.ts";
import { SessionManager } from "./session-manager.ts";

export interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
  services: AgentSessionServices;
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

export type CreateAgentSessionRuntimeFactory = (options: {
  cwd: string;
  agentDir: string;
  sessionManager: SessionManager;
  sessionStartEvent?: SessionStartEvent | undefined;
  projectTrustContext?: ProjectTrustContext | undefined;
}) => Promise<CreateAgentSessionRuntimeResult>;

export class SessionImportFileNotFoundError extends Error {
  readonly filePath: string;

  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = "SessionImportFileNotFoundError";
    this.filePath = filePath;
  }
}

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
}

export class AgentSessionRuntime {
  private rebindSession?: ((session: AgentSession) => Promise<void>) | undefined;
  private beforeSessionInvalidate?: (() => void) | undefined;
  private sessionInternal: AgentSession;
  private servicesInternal: AgentSessionServices;
  private readonly createRuntime: CreateAgentSessionRuntimeFactory;
  private diagnosticsInternal: AgentSessionRuntimeDiagnostic[];
  private modelFallbackMessageInternal?: string | undefined;

  constructor(
    _session: AgentSession,
    _services: AgentSessionServices,
    createRuntime: CreateAgentSessionRuntimeFactory,
    _diagnostics: AgentSessionRuntimeDiagnostic[] = [],
    _modelFallbackMessage?: string,
  ) {
    this.sessionInternal = _session;
    this.servicesInternal = _services;
    this.createRuntime = createRuntime;
    this.diagnosticsInternal = _diagnostics;
    this.modelFallbackMessageInternal = _modelFallbackMessage;
  }

  get services(): AgentSessionServices {
    return this.servicesInternal;
  }

  get session(): AgentSession {
    return this.sessionInternal;
  }

  get cwd(): string {
    return this.servicesInternal.cwd;
  }

  get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
    return this.diagnosticsInternal;
  }

  get modelFallbackMessage(): string | undefined {
    return this.modelFallbackMessageInternal;
  }

  setRebindSession(rebindSession?: (session: AgentSession) => Promise<void>): void {
    this.rebindSession = rebindSession;
  }

  setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
    this.beforeSessionInvalidate = beforeSessionInvalidate;
  }

  private emitBeforeSwitch(
    reason: "new" | "resume",
    targetSessionFile?: string,
  ): Effect.Effect<{ cancelled: boolean }> {
    return awaitingWith(function* () {
      const runner = this.session.extensionRunner;
      if (!runner.hasHandlers("session_before_switch")) {
        return { cancelled: false };
      }

      const result = yield* awaited(
        runner.emit({
          type: "session_before_switch",
          reason,
          targetSessionFile,
        }),
      );
      return { cancelled: result?.cancel === true };
    }, this);
  }

  private emitBeforeFork(
    entryId: string,
    options: { position: "before" | "at" },
  ): Effect.Effect<{ cancelled: boolean }> {
    return awaitingWith(function* () {
      const runner = this.session.extensionRunner;
      if (!runner.hasHandlers("session_before_fork")) {
        return { cancelled: false };
      }

      const result = yield* awaited(
        runner.emit({
          type: "session_before_fork",
          entryId,
          ...options,
        }),
      );
      return { cancelled: result?.cancel === true };
    }, this);
  }

  private teardownCurrent(
    reason: SessionShutdownEvent["reason"],
    targetSessionFile?: string,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.session.abort());
      yield* awaited(
        emitSessionShutdownEvent(this.session.extensionRunner, {
          type: "session_shutdown",
          reason,
          targetSessionFile,
        }),
      );
      this.beforeSessionInvalidate?.();
      this.session.dispose();
    }, this);
  }

  private apply(result: CreateAgentSessionRuntimeResult): void {
    this.sessionInternal = result.session;
    this.servicesInternal = result.services;
    this.diagnosticsInternal = result.diagnostics;
    this.modelFallbackMessageInternal = result.modelFallbackMessage;
  }

  private finishSessionReplacement(
    withSession?: (ctx: ReplacedSessionContext) => Promise<void>,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (this.rebindSession !== undefined) {
        yield* awaited(this.rebindSession(this.session));
      }
      if (withSession !== undefined) {
        yield* awaited(withSession(this.session.createReplacedSessionContext()));
      }
    }, this);
  }

  switchSession(
    sessionPath: string,
    options?: {
      cwdOverride?: string | undefined;
      withSession?: ((ctx: ReplacedSessionContext) => Promise<void>) | undefined;
      projectTrustContextFactory?: ((cwd: string) => ProjectTrustContext) | undefined;
    },
  ): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const beforeResult = yield* performed(this.emitBeforeSwitch("resume", sessionPath));
        if (beforeResult.cancelled) {
          return beforeResult;
        }

        const previousSessionFile = this.session.sessionFile;
        const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
        assertSessionCwdExists(sessionManager, this.cwd);
        yield* performed(this.teardownCurrent("resume", sessionManager.getSessionFile()));
        this.apply(
          yield* awaited(
            this.createRuntime({
              cwd: sessionManager.getCwd(),
              agentDir: this.services.agentDir,
              sessionManager,
              sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
              projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
            }),
          ),
        );
        yield* performed(this.finishSessionReplacement(options?.withSession));
        return { cancelled: false };
      }, this),
    );
  }

  newSession(options?: {
    parentSession?: string;
    setup?: (sessionManager: SessionManager) => Promise<void>;
    withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
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
              cwd: this.cwd,
              agentDir: this.services.agentDir,
              sessionManager,
              sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
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
      withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
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
                  cwd: this.cwd,
                  agentDir: this.services.agentDir,
                  sessionManager,
                  sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
                }),
              ),
            );
            yield* performed(this.finishSessionReplacement(options?.withSession));
            return { cancelled: false, selectedText };
          }

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
                cwd: sessionManager.getCwd(),
                agentDir: this.services.agentDir,
                sessionManager,
                sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
              }),
            ),
          );
          yield* performed(this.finishSessionReplacement(options?.withSession));
          return { cancelled: false, selectedText };
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
              cwd: this.cwd,
              agentDir: this.services.agentDir,
              sessionManager,
              sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
            }),
          ),
        );
        yield* performed(this.finishSessionReplacement(options?.withSession));
        return { cancelled: false, selectedText };
      }, this),
    );
  }

  importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const resolvedPath = resolvePath(inputPath);
        if (!existsSync(resolvedPath)) {
          throw new SessionImportFileNotFoundError(resolvedPath);
        }

        const sessionDir = this.session.sessionManager.getSessionDir();
        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }

        let destinationPath = join(sessionDir, basename(resolvedPath));
        const sourceAlreadyStored = resolve(destinationPath) === resolvedPath;
        if (!sourceAlreadyStored) {
          const { name, ext } = parse(destinationPath);
          let suffix = 1;
          while (existsSync(destinationPath)) {
            destinationPath = join(sessionDir, `${name}-${suffix++}${ext}`);
          }
        }
        const beforeResult = yield* performed(this.emitBeforeSwitch("resume", destinationPath));
        if (beforeResult.cancelled) {
          return beforeResult;
        }

        const previousSessionFile = this.session.sessionFile;
        if (!sourceAlreadyStored) {
          copyFileSync(resolvedPath, destinationPath, constants.COPYFILE_EXCL);
        }

        const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
        assertSessionCwdExists(sessionManager, this.cwd);
        yield* performed(this.teardownCurrent("resume", sessionManager.getSessionFile()));
        this.apply(
          yield* awaited(
            this.createRuntime({
              cwd: sessionManager.getCwd(),
              agentDir: this.services.agentDir,
              sessionManager,
              sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
            }),
          ),
        );
        yield* performed(this.finishSessionReplacement());
        return { cancelled: false };
      }, this),
    );
  }

  dispose(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(
          emitSessionShutdownEvent(this.session.extensionRunner, {
            type: "session_shutdown",
            reason: "quit",
          }),
        );
        this.beforeSessionInvalidate?.();
        this.session.dispose();
      }, this),
    );
  }
}

export function createAgentSessionRuntime(
  createRuntime: CreateAgentSessionRuntimeFactory,
  options: {
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
    sessionStartEvent?: SessionStartEvent;
  },
): Promise<AgentSessionRuntime> {
  return Effect.runPromise(
    awaiting(function* () {
      assertSessionCwdExists(options.sessionManager, options.cwd);
      const result = yield* awaited(createRuntime(options));
      return new AgentSessionRuntime(
        result.session,
        result.services,
        createRuntime,
        result.diagnostics,
        result.modelFallbackMessage,
      );
    }),
  );
}

export {
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionServicesOptions,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "./agent-session-services.ts";
