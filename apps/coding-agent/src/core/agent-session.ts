import compat from "@msa/ai/compat";

import type agentSessionTypes from "./agent-session.types.ts";
import SessionCommandsDomain from "./agent-session/commands-domain.ts";
import SessionCompactionDomain from "./agent-session/compaction-domain.ts";
import SessionContext from "./agent-session/context.ts";
import SessionExtensions from "./agent-session/extensions.ts";
import SessionIntegrations from "./agent-session/integrations.ts";
import SessionModels from "./agent-session/models.ts";
import SessionRun from "./agent-session/run.ts";
import SessionTools from "./agent-session/tools.ts";

const { cleanupSessionResources } = compat;

type Config = agentSessionTypes.AgentSessionConfig;

export default class AgentSession {
  readonly agent: Config["agent"];
  readonly sessionManager: Config["sessionManager"];
  readonly settingsManager: Config["settingsManager"];
  readonly resourceLoader: Config["resourceLoader"];
  readonly cwd: string;
  readonly agentDir: string;
  readonly tools: SessionTools;
  readonly models: SessionModels;
  readonly run: SessionRun;
  readonly context: SessionContext;
  readonly compaction: SessionCompactionDomain;
  readonly commands: SessionCommandsDomain;
  readonly extensions: SessionExtensions;
  readonly integrations: SessionIntegrations;

  private unsubscribeAgent: (() => void) | undefined;

  private eventListeners: agentSessionTypes.AgentSessionEventListener[] = [];

  constructor(config: Config) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this.settingsManager = config.settingsManager;
    this.resourceLoader = config.resourceLoader;
    this.cwd = config.cwd;
    this.agentDir = config.agentDir;
    this.tools = new SessionTools(this);
    this.models = new SessionModels(this);
    this.run = new SessionRun(this);
    this.context = new SessionContext(this);
    this.compaction = new SessionCompactionDomain(this);
    this.commands = new SessionCommandsDomain(this);
    this.extensions = new SessionExtensions(this);
    this.integrations = new SessionIntegrations(this);
    this.models.configure(config);
    this.tools.configure(config);
    this.extensions.binding.configure(config);
    this.integrations.start(config);
    this.unsubscribeAgent = this.agent.subscribe((event) =>
      this.extensions.events.handleAgentEvent(event),
    );
    this.installAgentHooks();
    this.extensions.runtime.start();
  }

  get state() {
    return this.agent.state;
  }

  get model() {
    return this.agent.state.model;
  }

  get thinkingLevel() {
    return this.agent.state.thinkingLevel;
  }

  get messages() {
    return this.agent.state.messages;
  }

  get isStreaming(): boolean {
    return this.run.lifecycle.isAgentRunActive;
  }

  get isIdle(): boolean {
    return !this.run.lifecycle.isAgentRunActive && !this.compaction.manual.isCompacting;
  }

  get sessionFile(): string | undefined {
    return this.sessionManager.getSessionFile();
  }

  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }

  get sessionName(): string | undefined {
    return this.sessionManager.getSessionName();
  }

  get promptTemplates() {
    return this.resourceLoader.getPrompts().prompts;
  }

  refreshContext(): void {
    this.context.transcript.refreshFinalizedContext();
  }

  emit(event: agentSessionTypes.AgentSessionEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  subscribe(listener: agentSessionTypes.AgentSessionEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  dispose(): Promise<void> {
    try {
      this.run.retry.abortRetry();
      this.compaction.manual.abortCompaction();
      this.context.tree.abortBranchSummary();
      this.context.bash.abortBash();
      this.integrations.goal.goalInternal.abort();
      this.agent.abort();
    } catch {}
    const closing = this.integrations.close();
    this.extensions.binding.invalidateStaleRunner();
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = undefined;
    this.integrations.telemetry.close();
    this.eventListeners = [];
    this.models.cacheWarming.dispose();
    cleanupSessionResources(this.sessionId);
    return closing;
  }

  private installAgentHooks(): void {
    this.tools.calls.installAgentToolHooks();
    this.extensions.events.installMessageFinalizer();
    this.run.projection.installAgentNextTurnRefresh();
    this.run.projection.installAgentRequestProjection();
    this.run.boundary.installAgentBoundaryHooks();
    this.run.projection.installHiddenDeclarationsProjection();
    this.run.projection.installAgentForcedPromptProjection();
  }
}
