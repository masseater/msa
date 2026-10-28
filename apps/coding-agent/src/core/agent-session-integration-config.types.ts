import type memoryTypes from "./memory/memory.types.ts";
import type sessionTelemetryTypes from "./observability/session-telemetry.types.ts";
import type orchestratorTypes from "./orchestrator/orchestrator.types.ts";

declare namespace agentSessionIntegrationConfigTypes {
  interface AgentSessionIntegrationConfig {
    createWorkerSession?:
      | ((
          options: orchestratorTypes.CreateWorkerOptions,
        ) => Promise<orchestratorTypes.WorkerSession>)
      | undefined;
    telemetry?: sessionTelemetryTypes.SessionTelemetryOptions | undefined;
    memoryConnection?: memoryTypes.MemoryConnectionOptions | undefined;
  }
}

export type { agentSessionIntegrationConfigTypes as default };
