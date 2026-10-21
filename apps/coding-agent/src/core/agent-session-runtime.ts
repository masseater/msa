import * as Effect from "effect/Effect";

import type agentSessionRuntimeTypes from "./agent-session-runtime.types.ts";
import SessionForking from "./agent-session-runtime/session-forking.ts";
import SessionReplacement from "./agent-session-runtime/session-replacement.ts";
import SessionTransitions from "./agent-session-runtime/session-transitions.ts";
import type agentSessionServicesTypes from "./agent-session-services.types.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import awaitingModule from "./awaiting.ts";
import runnerEvents from "./extensions/runner-events.ts";
import type telemetryTypesNs from "./observability/telemetry.types.ts";
const { awaited, awaitingWith } = awaitingModule;
const { emitSessionShutdownEvent } = runnerEvents;

export default class AgentSessionRuntime {
  readonly replacement: SessionReplacement;
  readonly forking: SessionForking;
  readonly transitions: SessionTransitions;

  rebindSession?: ((session: agentSessionTypes.AgentSession) => Promise<void>) | undefined;

  beforeSessionInvalidate?: (() => void) | undefined;

  sessionInternal!: agentSessionTypes.AgentSession;

  servicesInternal!: agentSessionServicesTypes.AgentSessionServices;

  createRuntime!: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory;

  diagnosticsInternal!: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[];

  modelFallbackMessageInternal?: string | undefined;

  telemetry!: telemetryTypesNs.TelemetryHandle | undefined;

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
        yield* awaited(this.session.settingsManager.persistence.flush());
        yield* awaited(this.telemetry?.dispose() ?? Promise.resolve());
      }, this),
    );
  }

  fork(...args: Parameters<SessionForking["fork"]>): ReturnType<SessionForking["fork"]> {
    return this.forking.fork(...args);
  }

  switchSession(
    ...args: Parameters<SessionTransitions["switchSession"]>
  ): ReturnType<SessionTransitions["switchSession"]> {
    return this.transitions.switchSession(...args);
  }

  newSession(
    ...args: Parameters<SessionTransitions["newSession"]>
  ): ReturnType<SessionTransitions["newSession"]> {
    return this.transitions.newSession(...args);
  }

  importFromJsonl(
    ...args: Parameters<SessionTransitions["importFromJsonl"]>
  ): ReturnType<SessionTransitions["importFromJsonl"]> {
    return this.transitions.importFromJsonl(...args);
  }

  constructor(
    _session: agentSessionTypes.AgentSession,
    _services: agentSessionServicesTypes.AgentSessionServices,
    createRuntime: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory,
    _diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] = [],
    _modelFallbackMessage?: string,
    telemetry?: telemetryTypesNs.TelemetryHandle,
  ) {
    this.replacement = new SessionReplacement(this);
    this.forking = new SessionForking(this);
    this.transitions = new SessionTransitions(this);
    this.telemetry = telemetry;
    this.sessionInternal = _session;
    this.servicesInternal = _services;
    this.createRuntime = createRuntime;
    this.diagnosticsInternal = _diagnostics;
    this.modelFallbackMessageInternal = _modelFallbackMessage;
  }
}
