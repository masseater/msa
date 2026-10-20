import telemetryModule from "@msa/telemetry";

import AgentSessionLayer35 from "./agent-session-layer-35.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import SessionTelemetry from "./observability/session-telemetry.ts";

const { NOOP_TELEMETRY_CONTEXT } = telemetryModule;

export default class AgentSession extends AgentSessionLayer35 {
  constructor(config: agentSessionTypes.AgentSessionConfig) {
    super(config);
    this.scopedModelsInternal = config.scopedModels ?? [];
    this.resourceLoaderInternal = config.resourceLoader;
    this.customTools = config.customTools ?? [];
    this.cwd = config.cwd;
    this.modelRuntimeInternal = config.modelRuntime;
    this.modelRuntimeInternal.setModelPolicy(this.settingsManager.getModelPolicy());
    this.cacheWarmer = config.cacheWarmer;
    if (this.cacheWarmer !== undefined) {
      this.cacheWarmer.onWarmed = (entry) => this.emit({ entry, type: "entry_appended" });
    }
    this.extensionRunnerRef = config.extensionRunnerRef;
    this.initialActiveToolNames = config.initialActiveToolNames;
    this.applyToolPolicy(config);
    this.baseToolsOverride = config.baseToolsOverride;
    this.sessionStartEvent = config.sessionStartEvent ?? {
      reason: "startup",
      type: "session_start",
    };
    this.goalInternal = this.createGoalLoop();
    const telemetry = config.telemetry ?? { context: NOOP_TELEMETRY_CONTEXT, role: "main" };
    this.telemetry = new SessionTelemetry(telemetry.context, telemetry.role);
    this.subscribe((event) => this.telemetry.handle(event));
    this.prWatchInternal = this.createPrWatch(telemetry.context);
    this.orchestratorInternal = this.createOrchestrator(
      config.createWorkerSession,
      telemetry.context,
    );
    this.watchOrchestratorChanges();
    this.unsubscribeAgent = this.agent.subscribe((event) => this.handleAgentEvent(event));
    this.installAgentHooks();
    this.buildRuntime({
      activeToolNames: this.initialActiveToolNames,
      includeAllExtensionTools: true,
    });
    if (this.usesDefaultTools) this.restoreToolsFromTranscript(this.defaultToolModifiers);
  }
}
