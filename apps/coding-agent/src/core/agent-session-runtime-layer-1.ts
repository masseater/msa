import * as Effect from "effect/Effect";

import AgentSessionRuntimeLayer0 from "./agent-session-runtime-layer-0.ts";
import type agentSessionRuntimeTypes from "./agent-session-runtime.types.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import runnerEvents from "./extensions/runner-events.ts";
import sessionCwd from "./session-cwd.ts";
import SessionManager from "./session-manager.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { emitSessionShutdownEvent } = runnerEvents;
const { assertSessionCwdExists } = sessionCwd;

export default abstract class AgentSessionRuntimeLayer1 extends AgentSessionRuntimeLayer0 {
  get services(): agentSessionServicesTypes.AgentSessionServices {
    return this.servicesInternal;
  }

  get session(): agentSessionTypes.AgentSession {
    return this.sessionInternal;
  }

  get cwd(): string {
    return this.servicesInternal.cwd;
  }

  get diagnostics(): readonly agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] {
    return this.diagnosticsInternal;
  }

  get modelFallbackMessage(): string | undefined {
    return this.modelFallbackMessageInternal;
  }

  setRebindSession(
    rebindSession?: (session: agentSessionTypes.AgentSession) => Promise<void>,
  ): void {
    this.rebindSession = rebindSession;
  }

  setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
    this.beforeSessionInvalidate = beforeSessionInvalidate;
  }

  protected emitBeforeSwitch(
    reason: "new" | "resume",
    targetSessionFile?: string,
  ): Effect.Effect<{ cancelled: boolean }> {
    return awaitingWith(function* () {
      const runner = this.session.extensions.binding.extensionRunner;
      if (!runner.hasHandlers("session_before_switch")) {
        return { cancelled: false };
      }

      const result = yield* awaited(
        runner.emit({
          reason,
          targetSessionFile,
          type: "session_before_switch",
        }),
      );
      return { cancelled: result?.cancel === true };
    }, this);
  }

  protected emitBeforeFork(
    entryId: string,
    options: { position: "before" | "at" },
  ): Effect.Effect<{ cancelled: boolean }> {
    return awaitingWith(function* () {
      const runner = this.session.extensions.binding.extensionRunner;
      if (!runner.hasHandlers("session_before_fork")) {
        return { cancelled: false };
      }

      const result = yield* awaited(
        runner.emit({
          entryId,
          type: "session_before_fork",
          ...options,
        }),
      );
      return { cancelled: result?.cancel === true };
    }, this);
  }

  protected teardownCurrent(
    reason: extensionsTypes.SessionShutdownEvent["reason"],
    targetSessionFile?: string,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.session.run.lifecycle.abort());
      yield* awaited(
        emitSessionShutdownEvent(this.session.extensions.binding.extensionRunner, {
          reason,
          targetSessionFile,
          type: "session_shutdown",
        }),
      );
      this.beforeSessionInvalidate?.();
      yield* awaited(this.session.dispose());
    }, this);
  }

  protected apply(result: agentSessionRuntimeTypes.CreateAgentSessionRuntimeResult): void {
    this.sessionInternal = result.session;
    this.servicesInternal = result.services;
    this.diagnosticsInternal = result.diagnostics;
    this.modelFallbackMessageInternal = result.modelFallbackMessage;
  }

  protected finishSessionReplacement(
    withSession?: (ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (this.rebindSession !== undefined) {
        yield* awaited(this.rebindSession(this.session));
      }
      if (withSession !== undefined) {
        yield* awaited(withSession(this.session.extensions.binding.createReplacedSessionContext()));
      }
    }, this);
  }

  switchSession(
    sessionPath: string,
    options?: {
      cwdOverride?: string | undefined;
      withSession?: ((ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>) | undefined;
      projectTrustContextFactory?:
        | ((cwd: string) => extensionsTypes.ProjectTrustContext)
        | undefined;
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
              agentDir: this.services.agentDir,
              cwd: sessionManager.getCwd(),
              projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
              sessionManager,
              sessionStartEvent: { previousSessionFile, reason: "resume", type: "session_start" },
            }),
          ),
        );
        yield* performed(this.finishSessionReplacement(options?.withSession));
        return { cancelled: false };
      }, this),
    );
  }

  dispose(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(
          emitSessionShutdownEvent(this.session.extensions.binding.extensionRunner, {
            reason: "quit",
            type: "session_shutdown",
          }),
        );
        this.beforeSessionInvalidate?.();
        yield* awaited(this.session.dispose());
        yield* awaited(this.telemetry?.dispose() ?? Promise.resolve());
      }, this),
    );
  }
}
