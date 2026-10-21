import type telemetryTypes from "@msa/telemetry/index.types";

import configModule from "../../config.ts";
import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import orchestratorSupport from "../orchestrator/orchestrator-support.ts";
import Orchestrator from "../orchestrator/orchestrator.ts";
import type orchestratorTypes from "../orchestrator/orchestrator.types.ts";
import platform from "../platform/index.ts";
import orchestratorCallbacks from "./orchestrator-callbacks.ts";

const { schedule } = platform;
const { ORCHESTRATOR_REPORT_MESSAGE_TYPE } = orchestratorSupport;
const { VERSION } = configModule;

export default class SessionOrchestration {
  orchestratorInternal: orchestratorTypes.Orchestrator | undefined;

  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  get orchestrator(): orchestratorTypes.Orchestrator | undefined {
    return this.orchestratorInternal;
  }

  start(
    createWorker: agentSessionTypes.AgentSessionConfig["createWorkerSession"],
    telemetry: telemetryTypes.TelemetryContext,
  ): void {
    this.orchestratorInternal = this.createOrchestrator(createWorker, telemetry);
    this.watchOrchestratorChanges();
  }

  close(): Promise<void> {
    return Promise.resolve(this.orchestratorInternal?.dispose().catch(() => undefined));
  }

  private watchOrchestratorChanges(): void {
    let orchestratorChangePending: ReturnType<typeof schedule> | undefined;
    this.orchestratorInternal?.onChange(() => {
      orchestratorChangePending ??= schedule(() => {
        orchestratorChangePending = undefined;
        this.session.emit({ type: "orchestrator_changed" });
      }, 100);
    });
  }

  private createOrchestrator(
    createWorker: agentSessionTypes.AgentSessionConfig["createWorkerSession"],
    telemetry: telemetryTypes.TelemetryContext,
  ): orchestratorTypes.Orchestrator | undefined {
    if (createWorker === undefined) return undefined;
    const { session } = this;
    return new Orchestrator({
      createWorker,
      cwd: session.cwd,
      databasePath: session.settingsManager.session.getOrchestratorDatabasePath(),
      defaults: () => orchestratorCallbacks.defaults(session),
      handoffDirectory: session.settingsManager.session.getHandoffDirectory(),
      project: session.sessionManager.getSessionId(),
      report: (text, details) =>
        void session.run.prompting.sendCustomMessage(
          { content: text, customType: ORCHESTRATOR_REPORT_MESSAGE_TYPE, details, display: true },
          { deliverAs: "followUp", triggerTurn: true },
        ),
      resolveModel: (reference) => orchestratorCallbacks.resolveModel(session, reference),
      runCondition: orchestratorCallbacks.runCondition,
      telemetry,
      version: VERSION,
    });
  }
}
