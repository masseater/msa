import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";

const { harness } = orchestratorHarness;

const { setup, taskStatus, waitFor } = harness;

const TASK = { currentState: "a is not done", goalState: "a is done", title: "a" };

const tracesATaskThroughItsWorkerAndPart1 = () =>
  Effect.gen(function* () {
    const { orchestrator, workers, telemetry } = setup();
    const task = yield* Effect.promise(() => orchestrator.createTask(TASK));
    yield* Effect.promise(() =>
      workers[0]!.telemetry.context.startSpan({ name: "msa.turn" }, () => undefined),
    );
    workers[0]?.complete("did a");
    yield* waitFor(() => workers.length === 2);
    workers[1]?.complete("looks good");
    yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");

    const spans = telemetry.getSpans();
    return { spans, task, telemetry, workers };
  });

const tracesATaskThroughItsWorkerAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { spans, task, telemetry, workers } = yield* tracesATaskThroughItsWorkerAndPart1();
      const taskSpan = spans.find((span) => span.name === "msa.task");
      expect(taskSpan).toMatchObject({
        attributes: { "msa.task.id": task.id, "msa.task.status": "completed" },
        parentId: null,
        settled: true,
        status: { status: "ok" },
      });
      const threads = spans.filter(
        (span) => span.name === "msa.thread" && span.attributes["msa.task.id"] === task.id,
      );
      expect(
        threads.map((span) => [
          span.parentId,
          span.attributes["msa.thread.role"],
          span.attributes["msa.task.id"],
          span.attributes["gen_ai.request.model"],
          span.attributes["msa.thread.status"],
        ]),
      ).toEqual([
        [taskSpan?.id, "worker", task.id, "fast/flash", "completed"],
        [taskSpan?.id, "reviewer", task.id, "sub/fable", "completed"],
      ]);
      expect(spans.find((span) => span.name === "msa.turn")?.parentId).toBe(threads[0]?.id);
      expect(workers.slice(0, 2).map((worker) => worker.telemetry.role)).toEqual([
        "worker",
        "reviewer",
      ]);

      const reports = telemetry
        .getLogs()
        .filter(
          (log) =>
            log.body === "msa.orchestrator.report" && log.attributes["msa.task.id"] === task.id,
        );
      expect(reports.map((log) => [log.spanId, log.attributes["msa.thread.role"]])).toEqual([
        [taskSpan?.id, "worker"],
        [null, "reviewer"],
      ]);
      const active = telemetry
        .getMetrics()
        .filter((metric) => metric.name === "msa.orchestrator.threads.active")
        .map((metric) => metric.value);
      expect(active[0]).toBe(0);
      expect(active).toContain(1);
    }),
  );

it(
  "traces a task through its worker and reviewer threads and logs each report",
  tracesATaskThroughItsWorkerAnd,
);

const endsTheSpansOfAStoppedTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, telemetry } = setup();
      const task = yield* Effect.promise(() => orchestrator.createTask(TASK));

      yield* Effect.promise(() => orchestrator.stop(task.id));

      const spans = telemetry
        .getSpans()
        .filter((span) => span.attributes["msa.task.id"] === task.id);
      expect(spans.map((span) => [span.name, span.settled, span.status])).toEqual([
        ["msa.task", true, { error: { message: "stopped", name: "TaskFailed" }, status: "error" }],
        [
          "msa.thread",
          true,
          { error: { message: "stopped", name: "ThreadFailed" }, status: "error" },
        ],
      ]);
    }),
  );

it("ends the spans of a stopped task as errors", endsTheSpansOfAStoppedTask);
