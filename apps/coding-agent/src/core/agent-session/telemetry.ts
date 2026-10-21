import telemetryModule from "@msa/telemetry";
import type telemetryTypes from "@msa/telemetry/index.types";

import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import SessionTelemetry from "../observability/session-telemetry.ts";

const { NOOP_TELEMETRY_CONTEXT } = telemetryModule;

export default class SessionTelemetryRecorder {
  private readonly session: AgentSession;

  private recorder: SessionTelemetry | undefined;

  constructor(session: AgentSession) {
    this.session = session;
  }

  start(
    options: agentSessionTypes.AgentSessionConfig["telemetry"],
  ): telemetryTypes.TelemetryContext {
    const telemetry = options ?? { context: NOOP_TELEMETRY_CONTEXT, role: "main" as const };
    const recorder = new SessionTelemetry(telemetry.context, telemetry.role);
    this.recorder = recorder;
    this.session.subscribe((event) => recorder.handle(event));
    return telemetry.context;
  }

  close(): void {
    this.recorder?.close();
  }
}
