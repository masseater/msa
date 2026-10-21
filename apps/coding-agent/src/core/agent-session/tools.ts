import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import SessionAskMode from "./ask-mode.ts";
import SessionExternalServiceTools from "./external-service-tools.ts";
import SessionSystemPrompt from "./system-prompt.ts";
import SessionToolCalls from "./tool-calls.ts";
import SessionToolLoadout from "./tool-loadout.ts";
import SessionToolPolicy from "./tool-policy.ts";
import SessionToolRegistry from "./tool-registry.ts";

export default class SessionTools {
  readonly ask: SessionAskMode;
  readonly policy: SessionToolPolicy;
  readonly registry: SessionToolRegistry;
  readonly loadout: SessionToolLoadout;
  readonly prompt: SessionSystemPrompt;
  readonly calls: SessionToolCalls;
  readonly externalServices: SessionExternalServiceTools;

  constructor(session: AgentSession) {
    this.ask = new SessionAskMode(session);
    this.policy = new SessionToolPolicy(session);
    this.registry = new SessionToolRegistry(session);
    this.loadout = new SessionToolLoadout(session);
    this.prompt = new SessionSystemPrompt(session);
    this.calls = new SessionToolCalls(session);
    this.externalServices = new SessionExternalServiceTools(session);
  }

  configure(config: agentSessionTypes.AgentSessionConfig): void {
    this.registry.configure(config);
    this.loadout.configure(config);
  }
}
