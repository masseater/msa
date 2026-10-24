import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import SessionDecision from "./decision.ts";
import SessionGoalEvaluation from "./goal-evaluation.ts";
import SessionGoal from "./goal.ts";
import SessionMemory from "./memory.ts";
import SessionOrchestration from "./orchestration.ts";
import SessionPrWatch from "./pr-watch.ts";
import SessionTelemetryRecorder from "./telemetry.ts";

export default class SessionIntegrations {
  readonly decision: SessionDecision;
  readonly goalEvaluation: SessionGoalEvaluation;
  readonly goal: SessionGoal;
  readonly memory: SessionMemory;
  readonly orchestration: SessionOrchestration;
  readonly prWatch: SessionPrWatch;
  readonly telemetry: SessionTelemetryRecorder;

  constructor(session: AgentSession) {
    this.decision = new SessionDecision(session);
    this.goalEvaluation = new SessionGoalEvaluation(session);
    this.goal = new SessionGoal(session);
    this.memory = new SessionMemory(session);
    this.orchestration = new SessionOrchestration(session);
    this.prWatch = new SessionPrWatch(session);
    this.telemetry = new SessionTelemetryRecorder(session);
  }

  start(config: agentSessionTypes.AgentSessionConfig): void {
    this.decision.start();
    this.goal.start();
    const telemetryContext = this.telemetry.start(config.telemetry);
    this.prWatch.start(telemetryContext);
    this.orchestration.start(config.createWorkerSession, telemetryContext);
  }

  close(): Promise<void> {
    return Promise.all([
      this.orchestration.close(),
      this.prWatch.close(),
      this.memory.close(),
    ]).then(() => undefined);
  }
}
