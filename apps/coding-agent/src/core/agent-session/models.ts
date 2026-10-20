import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import SessionCacheWarming from "./cache-warming.ts";
import SessionModelSelection from "./model-selection.ts";
import SessionRequestAuth from "./request-auth.ts";
import SessionThinking from "./thinking.ts";

export default class SessionModels {
  readonly selection: SessionModelSelection;
  readonly thinking: SessionThinking;
  readonly auth: SessionRequestAuth;
  readonly cacheWarming: SessionCacheWarming;

  constructor(session: AgentSession) {
    this.selection = new SessionModelSelection(session);
    this.thinking = new SessionThinking(session);
    this.auth = new SessionRequestAuth(session);
    this.cacheWarming = new SessionCacheWarming(session);
  }

  configure(config: agentSessionTypes.AgentSessionConfig): void {
    this.selection.configure(config.scopedModels ?? [], config.modelRuntime);
    this.cacheWarming.configure(config.cacheWarmer);
  }
}
