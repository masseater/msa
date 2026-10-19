import type { SpanAttributes, TelemetryContext } from "@msa/telemetry";

import { type OpenSpan, openSpan } from "../observability/open-span.ts";
import type { SessionTelemetryOptions } from "../observability/session-telemetry.ts";
import type {
  OrchestratorSnapshot,
  ReplanInput,
  ReplanResult,
  SessionRole,
  SessionStatus,
  Task,
  TaskStatus,
} from "./types.ts";
import type { OrchestratorReport } from "./worker.ts";

const FINISHED_TASK: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "stopped"]);

export interface SessionPlanTelemetry {
  readonly sessionId: string;
  readonly role: SessionRole;
  readonly model: string;
  readonly thinkingLevel: string;
}

function endStatus(
  status: SessionStatus | TaskStatus,
  name: string,
): Parameters<OpenSpan["end"]>[0] {
  if (status === "completed") return undefined;
  return { status: "error", error: { name, message: status } };
}

/**
 * Keeps the Task → Session spans of one orchestrator. A Task span stays open from its first
 * session until the task finishes; each Session span lives from launch until the session settles.
 * Both end when a published snapshot shows them finished, whichever action finished them.
 */
export class OrchestratorTelemetry {
  readonly context: TelemetryContext;
  readonly #tasks = new Map<string, OpenSpan>();
  readonly #sessions = new Map<string, OpenSpan>();

  constructor(context: TelemetryContext) {
    this.context = context;
  }

  sessionStarted(plan: SessionPlanTelemetry, task: Task): SessionTelemetryOptions {
    const taskSpan =
      this.#tasks.get(task.id) ??
      openSpan(this.context, {
        name: "msa.task",
        attributes: {
          "msa.task.id": task.id,
          "msa.task.kind": task.kind,
          "msa.task.title": task.title,
          "msa.task.round": task.round,
        },
      });
    this.#tasks.set(task.id, taskSpan);
    this.#sessions.get(plan.sessionId)?.end();
    const session = openSpan(taskSpan.span, {
      name: "msa.session",
      attributes: {
        "msa.session.id": plan.sessionId,
        "msa.session.role": plan.role,
        "msa.task.id": task.id,
        "gen_ai.request.model": plan.model,
        "msa.thinking_level": plan.thinkingLevel,
      },
    });
    this.#sessions.set(plan.sessionId, session);
    return { context: session.span, role: plan.role };
  }

  published(snapshot: OrchestratorSnapshot, activeSessions: number): void {
    for (const session of snapshot.sessions) {
      const span = this.#sessions.get(session.id);
      if (span === undefined || session.status === "running") continue;
      span.span.setAttributes({ "msa.session.status": session.status });
      span.end(endStatus(session.status, "SessionFailed"));
      this.#sessions.delete(session.id);
    }
    for (const task of snapshot.tasks) {
      const span = this.#tasks.get(task.id);
      if (span === undefined || !FINISHED_TASK.has(task.status)) continue;
      span.span.setAttributes({ "msa.task.status": task.status });
      span.end(endStatus(task.status, "TaskFailed"));
      this.#tasks.delete(task.id);
    }
    this.context.recordMetric({
      kind: "gauge",
      name: "msa.orchestrator.sessions.active",
      value: activeSessions,
      unit: "{session}",
      description: "Orchestrator sessions running now",
    });
  }

  reported(text: string, details: OrchestratorReport): void {
    const attributes: SpanAttributes = {
      "msa.task.id": details.taskId,
      "msa.session.role": details.role,
      "msa.report.status": details.status,
      "msa.report.started": [...details.started],
      "msa.report.text": text,
    };
    const task = this.#tasks.get(details.taskId);
    (task?.span ?? this.context).log({
      severity: details.status === "completed" ? "info" : "warn",
      body: "msa.orchestrator.report",
      attributes,
    });
  }

  replanned(input: ReplanInput, result: ReplanResult): void {
    this.context.log({
      severity: result.aborted === null ? "info" : "warn",
      body: "msa.orchestrator.replan",
      attributes: {
        "msa.replan.id": result.replanId ?? undefined,
        "msa.replan.reason": input.reason,
        "msa.replan.aborted": result.aborted ?? undefined,
        "msa.replan.stopped": result.stopped.length,
        "msa.replan.created": result.created.length,
        "msa.replan.dropped": result.dropped.length,
        "msa.replan.started": result.started.length,
      },
    });
  }

  /** Ends whatever is still open; msa is shutting down. */
  close(): void {
    for (const span of [...this.#sessions.values(), ...this.#tasks.values()]) {
      span.span.setAttributes({ "msa.unfinished": true });
      span.end();
    }
    this.#sessions.clear();
    this.#tasks.clear();
  }
}
