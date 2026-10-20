import type telemetryTypes from "@msa/telemetry/index.types";

import configModule from "../config.ts";
import AgentSessionLayer32 from "./agent-session-layer-32.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import orchestratorSupport from "./orchestrator/orchestrator-support.ts";
import Orchestrator from "./orchestrator/orchestrator.ts";
import type orchestratorTypes from "./orchestrator/orchestrator.types.ts";

const { ORCHESTRATOR_REPORT_MESSAGE_TYPE } = orchestratorSupport;
const { VERSION } = configModule;

export default abstract class AgentSessionLayer33 extends AgentSessionLayer32 {
  protected createOrchestrator(
    createWorker: agentSessionTypes.AgentSessionConfig["createWorkerSession"],
    telemetry: telemetryTypes.TelemetryContext,
  ): orchestratorTypes.Orchestrator | undefined {
    if (createWorker === undefined) return undefined;
    return new Orchestrator({
      createWorker,
      cwd: this.cwd,
      databasePath: this.settingsManager.getOrchestratorDatabasePath(),
      defaults: () => this.orchestratorDefaults(),
      handoffDirectory: this.settingsManager.getHandoffDirectory(),
      project: this.sessionManager.getSessionId(),
      report: (text, details) =>
        void this.sendCustomMessage(
          { content: text, customType: ORCHESTRATOR_REPORT_MESSAGE_TYPE, details, display: true },
          { deliverAs: "followUp", triggerTurn: true },
        ),
      resolveModel: (reference) => this.resolveOrchestratorModel(reference),
      runCondition: (command, cwd) => this.runCondition(command, cwd),
      telemetry,
      version: VERSION,
    });
  }
}
