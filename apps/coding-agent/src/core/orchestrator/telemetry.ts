import type telemetryTypes from "@msa/telemetry/index.types";

import openSpanModule from "../observability/open-span.ts";
import type openSpanTypes from "../observability/open-span.types.ts";
import type sessionTelemetryTypes from "../observability/session-telemetry.types.ts";
import type telemetryTypesNs from "./telemetry.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

const { openSpan } = openSpanModule;

const FINISHED_TASK: ReadonlySet<orchestratorTypesTypes.TaskStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "closed",
]);

function endStatus(
  status: orchestratorTypesTypes.ThreadStatus | orchestratorTypesTypes.TaskStatus,
  name: string,
): Parameters<openSpanTypes.OpenSpan["end"]>[0] {
  if (status === "completed") return undefined;
  return { error: { message: status, name }, status: "error" };
}

export default class OrchestratorTelemetry {
  readonly context: telemetryTypes.TelemetryContext;
  readonly #tasks = new Map<string, openSpanTypes.OpenSpan>();
  readonly #threads = new Map<string, openSpanTypes.OpenSpan>();

  constructor(context: telemetryTypes.TelemetryContext) {
    this.context = context;
  }

  threadStarted(
    plan: telemetryTypesNs.ThreadPlanTelemetry,
    task: orchestratorTypesTypes.Task,
  ): sessionTelemetryTypes.SessionTelemetryOptions {
    const taskSpan =
      this.#tasks.get(task.id) ??
      openSpan(this.context, {
        attributes: {
          "msa.task.id": task.id,
          "msa.task.kind": task.kind,
          "msa.task.round": task.round,
          "msa.task.title": task.title,
        },
        name: "msa.task",
      });
    this.#tasks.set(task.id, taskSpan);
    this.#threads.get(plan.threadId)?.end();
    const thread = openSpan(taskSpan.span, {
      attributes: {
        "gen_ai.request.model": plan.model,
        "msa.task.id": task.id,
        "msa.thinking_level": plan.thinkingLevel,
        "msa.thread.id": plan.threadId,
        "msa.thread.role": plan.role,
      },
      name: "msa.thread",
    });
    this.#threads.set(plan.threadId, thread);
    return { context: thread.span, role: plan.role };
  }

  published(snapshot: orchestratorTypesTypes.OrchestratorSnapshot, activeThreads: number): void {
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
      description: "Orchestrator threads running now",
      kind: "gauge",
      name: "msa.orchestrator.threads.active",
      unit: "{thread}",
      value: activeThreads,
    });
  }

  reported(text: string, details: workerTypes.OrchestratorReport): void {
    const attributes: telemetryTypes.SpanAttributes = {
      "msa.report.started": [...details.started],
      "msa.report.status": details.status,
      "msa.report.text": text,
      "msa.task.id": details.taskId,
      "msa.thread.role": details.role,
    };
    const task = this.#tasks.get(details.taskId);
    (task?.span ?? this.context).log({
      attributes,
      body: "msa.orchestrator.report",
      severity: details.status === "completed" ? "info" : "warn",
    });
  }

  replanned(
    input: orchestratorTypesTypes.ReplanInput,
    result: orchestratorTypesTypes.ReplanResult,
  ): void {
    this.context.log({
      attributes: {
        "msa.replan.aborted": result.aborted ?? undefined,
        "msa.replan.created": result.created.length,
        "msa.replan.dropped": result.dropped.length,
        "msa.replan.id": result.replanId ?? undefined,
        "msa.replan.reason": input.reason,
        "msa.replan.started": result.started.length,
        "msa.replan.stopped": result.stopped.length,
      },
      body: "msa.orchestrator.replan",
      severity: result.aborted === null ? "info" : "warn",
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
