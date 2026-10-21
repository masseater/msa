import type AgentSession from "../agent-session.ts";
import SessionBoundary from "./boundary.ts";
import SessionPrompting from "./prompting.ts";
import SessionQueue from "./queue.ts";
import SessionRequestProjection from "./request-projection.ts";
import SessionRetry from "./retry.ts";
import SessionRunLifecycle from "./run-lifecycle.ts";
import SessionTurnTriggers from "./turn-triggers.ts";

export default class SessionRun {
  readonly lifecycle: SessionRunLifecycle;
  readonly prompting: SessionPrompting;
  readonly queue: SessionQueue;
  readonly triggers: SessionTurnTriggers;
  readonly boundary: SessionBoundary;
  readonly retry: SessionRetry;
  readonly projection: SessionRequestProjection;

  constructor(session: AgentSession) {
    this.lifecycle = new SessionRunLifecycle(session);
    this.prompting = new SessionPrompting(session);
    this.queue = new SessionQueue(session);
    this.triggers = new SessionTurnTriggers(session);
    this.boundary = new SessionBoundary(session);
    this.retry = new SessionRetry(session);
    this.projection = new SessionRequestProjection(session);
  }
}
