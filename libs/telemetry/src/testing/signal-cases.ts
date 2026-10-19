import { deepStrictEqual, doesNotThrow, ok, strictEqual } from "node:assert/strict";

import { Effect } from "effect";

import type { TelemetryLogRecord, TelemetryMetricRecord, TelemetrySpan } from "../context.ts";
import type { RecordedTelemetryLog, RecordedTelemetryMetric } from "../memory.ts";
import type { ConformanceCaseDefinition, ConformanceTest } from "./support.ts";
import { findSpan, recordedSpans, unreadable } from "./support.ts";
import type { TelemetryAdapterFixture } from "./types.ts";

function recordedLogs(
  fixture: TelemetryAdapterFixture,
): Effect.Effect<readonly RecordedTelemetryLog[]> {
  return Effect.promise(() => fixture.getLogs());
}

function recordedMetrics(
  fixture: TelemetryAdapterFixture,
): Effect.Effect<readonly RecordedTelemetryMetric[]> {
  return Effect.promise(() => fixture.getMetrics());
}

function findLog(logs: readonly RecordedTelemetryLog[], body: string): RecordedTelemetryLog {
  const log = logs.find((candidate) => candidate.body === body);
  ok(log, `Expected recorded log ${body}`);
  return log;
}

function findMetric(
  metrics: readonly RecordedTelemetryMetric[],
  name: string,
): RecordedTelemetryMetric {
  const metric = metrics.find((candidate) => candidate.name === name);
  ok(metric, `Expected recorded metric ${name}`);
  return metric;
}

const recordsLogs: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    fixture.context.log({
      severity: "info",
      body: "root log",
      attributes: { kept: "value", ignored: undefined },
    });
    yield* Effect.promise(() =>
      fixture.context.startSpan({ name: "logging" }, (span) => {
        span.log({ severity: "error", body: "span log", attributes: { count: 2 } });
      }),
    );

    const logs = yield* recordedLogs(fixture);
    const span = findSpan(yield* recordedSpans(fixture), "logging");
    deepStrictEqual(findLog(logs, "root log"), {
      spanId: null,
      severity: "info",
      body: "root log",
      attributes: { kept: "value" },
    });
    deepStrictEqual(findLog(logs, "span log"), {
      spanId: span.id,
      severity: "error",
      body: "span log",
      attributes: { count: 2 },
    });
  });

const recordsMetrics: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    fixture.context.recordMetric({
      kind: "counter",
      name: "conformance.counter",
      value: 3,
      attributes: { kind: "input" },
    });
    fixture.context.recordMetric({
      kind: "histogram",
      name: "conformance.histogram",
      value: 1.5,
      unit: "s",
    });
    fixture.context.recordMetric({ kind: "gauge", name: "conformance.gauge", value: 4 });

    const metrics = yield* recordedMetrics(fixture);
    deepStrictEqual(findMetric(metrics, "conformance.counter"), {
      kind: "counter",
      name: "conformance.counter",
      value: 3,
      attributes: { kind: "input" },
    });
    deepStrictEqual(findMetric(metrics, "conformance.histogram"), {
      kind: "histogram",
      name: "conformance.histogram",
      value: 1.5,
      unit: "s",
      attributes: {},
    });
    deepStrictEqual(findMetric(metrics, "conformance.gauge"), {
      kind: "gauge",
      name: "conformance.gauge",
      value: 4,
      attributes: {},
    });
  });

const settledSpan = (fixture: TelemetryAdapterFixture): Effect.Effect<TelemetrySpan> =>
  Effect.gen(function* () {
    let captured: TelemetrySpan | undefined;
    yield* Effect.promise(() =>
      fixture.context.startSpan({ name: "settled-signals" }, (span) => {
        captured = span;
      }),
    );
    if (captured === undefined) return yield* Effect.die(new Error("Expected callback span"));
    return captured;
  });

const ignoresInertSignals: ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    const span = yield* settledSpan(fixture);
    doesNotThrow(() => span.log({ severity: "warn", body: "late log" }));
    doesNotThrow(() => span.recordMetric({ kind: "counter", name: "late.counter", value: 1 }));
    doesNotThrow(() =>
      fixture.context.log(unreadable<TelemetryLogRecord>({ severity: "info", body: "hidden" })),
    );
    doesNotThrow(() =>
      fixture.context.recordMetric(
        unreadable<TelemetryMetricRecord>({ kind: "counter", name: "hidden.counter", value: 1 }),
      ),
    );

    deepStrictEqual(yield* recordedLogs(fixture), []);
    strictEqual(
      (yield* recordedMetrics(fixture)).some((metric) => metric.name.endsWith(".counter")),
      false,
    );
  });

export const signalCases: readonly ConformanceCaseDefinition[] = [
  { group: "signals", name: "records logs with their parent span", test: recordsLogs },
  { group: "signals", name: "records counter, histogram, and gauge values", test: recordsMetrics },
  {
    group: "signals",
    name: "ignores signals on settled spans and unreadable payloads",
    test: ignoresInertSignals,
  },
];
