import type { AgentSessionEvent as AgentSessionEventSource } from "../../../src/core/agent-session.ts";

declare namespace agentTypes {
  type AgentSessionEvent = AgentSessionEventSource;
}

export type { agentTypes as default };
