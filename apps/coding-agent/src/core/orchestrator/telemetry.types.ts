import type OrchestratorTelemetryClass from "./telemetry.ts";
import type orchestratorTypesTypes from "./types.types.ts";

declare namespace telemetryTypesNs {
  interface ThreadPlanTelemetry {
    readonly threadId: string;
    readonly role: orchestratorTypesTypes.ThreadRole;
    readonly model: string;
    readonly thinkingLevel: string;
  }

  type OrchestratorTelemetry = (typeof OrchestratorTelemetryClass)["prototype"];
}

export type { telemetryTypesNs as default };
