import type { SpanAttributes, TelemetryContext } from "@msa/telemetry";

import { type OpenSpan, openSpan } from "../observability/open-span.ts";
import type { SessionTelemetryOptions } from "../observability/session-telemetry.ts";
import type {
  OrchestratorSnapshot,
  ReplanInput,
  ReplanResult,
  ThreadRole,
  ThreadStatus,
  Task,
  TaskStatus,
} from "./types.ts";
import type { OrchestratorReport } from "./worker.ts";

const FINISHED_TASK: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "stopped"]);

export interface ThreadPlanTelemetry {
  readonly threadId: string;
  readonly role: ThreadRole;
  readonly model: string;
  readonly thinkingLevel: string;
}

function endStatus(
  status: ThreadStatus | TaskStatus,
  name: string,
): Parameters<OpenSpan["end"]>[0] {
  if (status === "completed") return undefined;
  return { status: "error", error: { name, message: status } };
}

export class OrchestratorTelemetry {
  readonly context: TelemetryContext;
  readonly #tasks = new Map<string, OpenSpan>();
  readonly #threads = new Map<string, OpenSpan>();

  constructor(context: TelemetryContext) {
    this.context = context;
  }

  threadStarted(plan: ThreadPlanTelemetry, task: Task): SessionTelemetryOptions {
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
    this.#threads.get(plan.threadId)?.end();
    const thread = openSpan(taskSpan.span, {
      name: "msa.thread",
      attributes: {
        "msa.thread.id": plan.threadId,
        "msa.thread.role": plan.role,
        "msa.task.id": task.id,
        "gen_ai.request.model": plan.model,
        "msa.thinking_level": plan.thinkingLevel,
      },
    });
    this.#threads.set(plan.threadId, thread);
    return { context: thread.span, role: plan.role };
  }

  published(snapshot: OrchestratorSnapshot, activeThreads: number): void {
    for (const thread of snapshot.threads) {
      const span = this.#threads.get(thread.id);
      if (span === undefined || thread.status === "running") continue;
      span.span.setAttributes({ "msa.thread.status": thread.status });
      span.end(endStatus(thread.status, "ThreadFailed"));
      this.#threads.delete(thread.id);
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
      name: "msa.orchestrator.threads.active",
      value: activeThreads,
      unit: "{thread}",
      description: "Orchestrator threads running now",
    });
  }

  reported(text: string, details: OrchestratorReport): void {
    const attributes: SpanAttributes = {
      "msa.task.id": details.taskId,
      "msa.thread.role": details.role,
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

  close(): void {
    for (const span of [...this.#threads.values(), ...this.#tasks.values()]) {
      span.span.setAttributes({ "msa.unfinished": true });
      span.end();
    }
    this.#threads.clear();
    this.#tasks.clear();
  }
}
