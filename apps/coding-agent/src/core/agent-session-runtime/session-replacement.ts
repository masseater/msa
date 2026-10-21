import * as Effect from "effect/Effect";

import type AgentSessionRuntime from "../agent-session-runtime.ts";
import type agentSessionRuntimeTypes from "../agent-session-runtime.types.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import runnerEvents from "../extensions/runner-events.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { emitSessionShutdownEvent } = runnerEvents;

type ReplaceOptions = {
  cwd?: string;
  prepare?: (() => void) | undefined;
  projectTrustContext?: extensionsTypes.ProjectTrustContext | undefined;
  setup?: ((sessionManager: sessionManagerTypes.SessionManager) => Promise<void>) | undefined;
  withSession?: ((ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>) | undefined;
};

export default class SessionReplacement {
  private readonly runtime: AgentSessionRuntime;

  constructor(runtime: AgentSessionRuntime) {
    this.runtime = runtime;
  }

  emitBeforeSwitch(
    reason: "new" | "resume",
    targetSessionFile?: string,
  ): Effect.Effect<{ cancelled: boolean }> {
    return awaitingWith(function* () {
      const runner = this.runtime.session.extensions.binding.extensionRunner;
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

  emitBeforeFork(
    entryId: string,
    options: { position: "before" | "at" },
  ): Effect.Effect<{ cancelled: boolean }> {
    return awaitingWith(function* () {
      const runner = this.runtime.session.extensions.binding.extensionRunner;
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

  teardownCurrent(
    reason: extensionsTypes.SessionShutdownEvent["reason"],
    targetSessionFile?: string,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.runtime.session.run.lifecycle.abort());
      yield* awaited(
        emitSessionShutdownEvent(this.runtime.session.extensions.binding.extensionRunner, {
          reason,
          targetSessionFile,
          type: "session_shutdown",
        }),
      );
      this.runtime.beforeSessionInvalidate?.();
      yield* awaited(this.runtime.session.dispose());
    }, this);
  }

  apply(result: agentSessionRuntimeTypes.CreateAgentSessionRuntimeResult): void {
    this.runtime.sessionInternal = result.session;
    this.runtime.servicesInternal = result.services;
    this.runtime.diagnosticsInternal = result.diagnostics;
    this.runtime.modelFallbackMessageInternal = result.modelFallbackMessage;
  }

  finishSessionReplacement(
    withSession?: (ctx: extensionsTypes.ReplacedSessionContext) => Promise<void>,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (this.runtime.rebindSession !== undefined) {
        yield* awaited(this.runtime.rebindSession(this.runtime.session));
      }
      if (withSession !== undefined) {
        yield* awaited(
          withSession(this.runtime.session.extensions.binding.createReplacedSessionContext()),
        );
      }
    }, this);
  }

  replace(
    reason: "new" | "resume" | "fork",
    sessionManager: sessionManagerTypes.SessionManager,
    previousSessionFile: string | undefined,
    options: ReplaceOptions = {},
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* performed(this.teardownCurrent(reason, sessionManager.getSessionFile()));
      options.prepare?.();
      this.apply(
        yield* awaited(
          this.runtime.createRuntime({
            agentDir: this.runtime.services.agentDir,
            cwd: options.cwd ?? this.runtime.cwd,
            ...(options.projectTrustContext === undefined
              ? {}
              : { projectTrustContext: options.projectTrustContext }),
            sessionManager,
            sessionStartEvent: { previousSessionFile, reason, type: "session_start" },
          }),
        ),
      );
      if (options.setup !== undefined) {
        yield* awaited(options.setup(this.runtime.session.sessionManager));
        this.runtime.session.refreshContext();
      }
      yield* performed(this.finishSessionReplacement(options.withSession));
    }, this);
  }
}
