import { deepStrictEqual, doesNotThrow, ok, strictEqual } from "node:assert/strict";

import { Effect } from "effect";

import type contextTypes from "../context.ts";
import type memoryTypes from "../memory.types.ts";
import support from "./support.ts";
import type supportTypes from "./support.types.ts";
import type typesModule from "./types.ts";

const { findSpan, recordedSpans, unreadable } = support;

function recordedLogs(
  fixture: typesModule.TelemetryAdapterFixture,
): Effect.Effect<readonly memoryTypes.RecordedTelemetryLog[]> {
  return Effect.promise(() => fixture.getLogs());
}

function recordedMetrics(
  fixture: typesModule.TelemetryAdapterFixture,
): Effect.Effect<readonly memoryTypes.RecordedTelemetryMetric[]> {
  return Effect.promise(() => fixture.getMetrics());
}

function findLog(
  logs: readonly memoryTypes.RecordedTelemetryLog[],
  body: string,
): memoryTypes.RecordedTelemetryLog {
  const log = logs.find((candidate) => candidate.body === body);
  ok(log, `Expected recorded log ${body}`);
  return log;
}

function findMetric(
  metrics: readonly memoryTypes.RecordedTelemetryMetric[],
  name: string,
): memoryTypes.RecordedTelemetryMetric {
  const metric = metrics.find((candidate) => candidate.name === name);
  ok(metric, `Expected recorded metric ${name}`);
  return metric;
}

const recordsLogs: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    fixture.context.log({
      attributes: { ignored: undefined, kept: "value" },
      body: "root log",
      severity: "info",
    });
    yield* Effect.promise(() =>
      fixture.context.startSpan({ name: "logging" }, (span) => {
        span.log({ attributes: { count: 2 }, body: "span log", severity: "error" });
      }),
    );

    const logs = yield* recordedLogs(fixture);
    const span = findSpan(yield* recordedSpans(fixture), "logging");
    deepStrictEqual(findLog(logs, "root log"), {
      attributes: { kept: "value" },
      body: "root log",
      severity: "info",
      spanId: null,
    });
    deepStrictEqual(findLog(logs, "span log"), {
      attributes: { count: 2 },
      body: "span log",
      severity: "error",
      spanId: span.id,
    });
  });

const recordsMetrics: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    fixture.context.recordMetric({
      attributes: { kind: "input" },
      kind: "counter",
      name: "conformance.counter",
      value: 3,
    });
    fixture.context.recordMetric({
      kind: "histogram",
      name: "conformance.histogram",
      unit: "s",
      value: 1.5,
    });
    fixture.context.recordMetric({ kind: "gauge", name: "conformance.gauge", value: 4 });

    const metrics = yield* recordedMetrics(fixture);
    deepStrictEqual(findMetric(metrics, "conformance.counter"), {
      attributes: { kind: "input" },
      kind: "counter",
      name: "conformance.counter",
      value: 3,
    });
    deepStrictEqual(findMetric(metrics, "conformance.histogram"), {
      attributes: {},
      kind: "histogram",
      name: "conformance.histogram",
      unit: "s",
      value: 1.5,
    });
    deepStrictEqual(findMetric(metrics, "conformance.gauge"), {
      attributes: {},
      kind: "gauge",
      name: "conformance.gauge",
      value: 4,
    });
  });

const settledSpan = (
  fixture: typesModule.TelemetryAdapterFixture,
): Effect.Effect<contextTypes.TelemetrySpan> =>
  Effect.gen(function* () {
    let captured: contextTypes.TelemetrySpan | undefined;
    yield* Effect.promise(() =>
      fixture.context.startSpan({ name: "settled-signals" }, (span) => {
        captured = span;
      }),
    );
    if (captured === undefined) return yield* Effect.die(new Error("Expected callback span"));
    return captured;
  });

const ignoresInertSignals: supportTypes.ConformanceTest = (fixture) =>
  Effect.gen(function* () {
    const span = yield* settledSpan(fixture);
    doesNotThrow(() => span.log({ body: "late log", severity: "warn" }));
    doesNotThrow(() => span.recordMetric({ kind: "counter", name: "late.counter", value: 1 }));
    doesNotThrow(() =>
      fixture.context.log(
        unreadable<contextTypes.TelemetryLogRecord>({ body: "hidden", severity: "info" }),
      ),
    );
    doesNotThrow(() =>
      fixture.context.recordMetric(
        unreadable<contextTypes.TelemetryMetricRecord>({
          kind: "counter",
          name: "hidden.counter",
          value: 1,
        }),
      ),
    );

    deepStrictEqual(yield* recordedLogs(fixture), []);
    strictEqual(
      (yield* recordedMetrics(fixture)).some((metric) => metric.name.endsWith(".counter")),
      false,
    );
  });

const signalCases: readonly supportTypes.ConformanceCaseDefinition[] = [
  { group: "signals", name: "records logs with their parent span", test: recordsLogs },
  { group: "signals", name: "records counter, histogram, and gauge values", test: recordsMetrics },
  {
    group: "signals",
    name: "ignores signals on settled spans and unreadable payloads",
    test: ignoresInertSignals,
  },
];

const signalCasesModule = {
  signalCases,
};

export default signalCasesModule;
