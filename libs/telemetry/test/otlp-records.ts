import type telemetryTypes from "../src/index.types.ts";
import type otlpRecordsTypes from "./otlp-records.types.ts";

function scalar(value: otlpRecordsTypes.OtlpValue): string | number | boolean {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  return value.doubleValue ?? 0;
}

function attributeValue(value: otlpRecordsTypes.OtlpValue): telemetryTypes.AttributeValue {
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values ?? []).map(scalar) as telemetryTypes.AttributeValue;
  }
  return scalar(value);
}

function attributes(
  list: readonly otlpRecordsTypes.OtlpAttribute[],
  hidden: readonly string[] = [],
): telemetryTypes.SpanAttributes {
  const result: telemetryTypes.SpanAttributes = {};
  for (const { key, value } of list) {
    if (!hidden.includes(key) && !key.startsWith("effect.")) result[key] = attributeValue(value);
  }
  return result;
}

function statusOf(span: otlpRecordsTypes.OtlpSpan): telemetryTypes.SpanStatus {
  if (span.status.code !== 2) return { status: "ok" };
  const exception = span.events.find((event) => event.name === "exception");
  if (exception === undefined) return { status: "error" };
  const details = attributes(exception.attributes);
  return {
    error: {
      message: String(details["exception.message"]),
      name: String(details["exception.type"]),
    },
    status: "error",
  };
}

function normalizeSpans(received: otlpRecordsTypes.Received): {
  spans: telemetryTypes.RecordedTelemetrySpan[];
  ids: Map<string, number>;
} {
  const started = received.spans.toSorted((a, b) =>
    Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)),
  );
  const ended = received.spans.toSorted((a, b) =>
    Number(BigInt(a.endTimeUnixNano) - BigInt(b.endTimeUnixNano)),
  );
  const ids = new Map(started.map((span, index) => [span.spanId, index + 1]));
  const spans = started.map((span): telemetryTypes.RecordedTelemetrySpan => ({
    attributes: attributes(span.attributes),
    endSequence: ended.indexOf(span) + 1,
    events: span.events
      .filter((event) => event.name !== "exception")
      .map((event) => ({ attributes: attributes(event.attributes), name: event.name })),
    id: ids.get(span.spanId)!,
    name: span.name,
    parentId: span.parentSpanId === undefined ? null : (ids.get(span.parentSpanId) ?? null),
    settled: true,
    status: statusOf(span),
  }));
  return { ids, spans };
}

const severities: Readonly<Record<string, telemetryTypes.TelemetryLogSeverity>> = {
  Error: "error",
  Info: "info",
  Warn: "warn",
};

function normalizeLogs(received: otlpRecordsTypes.Received): telemetryTypes.RecordedTelemetryLog[] {
  const { ids } = normalizeSpans(received);
  return received.logs.map((log) => ({
    attributes: attributes(log.attributes),
    body: String(scalar(log.body)),
    severity: severities[log.severityText] ?? "info",
    spanId: log.spanId === undefined || log.spanId === "" ? null : (ids.get(log.spanId) ?? null),
  }));
}

function normalizeMetrics(
  received: otlpRecordsTypes.Received,
): telemetryTypes.RecordedTelemetryMetric[] {
  return [...received.metrics.values()].flatMap((metric) => {
    const [kind, points]: [
      telemetryTypes.TelemetryMetricKind,
      readonly otlpRecordsTypes.OtlpDataPoint[],
    ] =
      metric.histogram === undefined
        ? metric.gauge === undefined
          ? ["counter", metric.sum?.dataPoints ?? []]
          : ["gauge", metric.gauge.dataPoints]
        : ["histogram", metric.histogram.dataPoints];
    const unit = metric.unit === undefined || metric.unit === "1" ? {} : { unit: metric.unit };
    return points.map((point): telemetryTypes.RecordedTelemetryMetric =>
      Object.assign(
        {
          attributes: attributes(point.attributes, ["unit"]),
          kind,
          name: metric.name,
          value:
            kind === "histogram" ? (point.sum ?? 0) : Number(point.asDouble ?? point.asInt ?? 0),
        },
        unit,
      ),
    );
  });
}

function receive(
  received: otlpRecordsTypes.Received,
  path: string,
  payload: otlpRecordsTypes.Payload,
): void {
  if (path === "/v1/traces") {
    for (const resource of payload.resourceSpans ?? []) {
      for (const scope of resource.scopeSpans ?? []) received.spans.push(...(scope.spans ?? []));
    }
  } else if (path === "/v1/logs") {
    for (const resource of payload.resourceLogs ?? []) {
      for (const scope of resource.scopeLogs ?? []) received.logs.push(...(scope.logRecords ?? []));
    }
  } else if (path === "/v1/metrics") {
    for (const resource of payload.resourceMetrics ?? []) {
      for (const scope of resource.scopeMetrics ?? []) {
        for (const metric of scope.metrics ?? []) received.metrics.set(metric.name, metric);
      }
    }
  }
}

const otlpRecords = { normalizeLogs, normalizeMetrics, normalizeSpans, receive };

export default otlpRecords;
