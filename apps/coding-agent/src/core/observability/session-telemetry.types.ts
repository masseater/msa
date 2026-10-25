import type telemetryTypes from "@msa/telemetry/index.types";

import type SessionTelemetryClass from "./session-telemetry.ts";

declare namespace sessionTelemetryTypes {
  type SessionTelemetryRole = "main" | "worker" | "reviewer" | "advisor" | "triage";

  interface SessionTelemetryOptions {
    readonly context: telemetryTypes.TelemetryContext;
    readonly role: SessionTelemetryRole;
  }

  type SessionTelemetry = (typeof SessionTelemetryClass)["prototype"];
}

export type { sessionTelemetryTypes as default };
