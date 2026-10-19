import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type {
  AttributeValue,
  RecordedTelemetryLog,
  RecordedTelemetryMetric,
  RecordedTelemetrySpan,
  SpanAttributes,
  SpanStatus,
  TelemetryLogSeverity,
  TelemetryMetricKind,
} from "../src/index.ts";
import { layer, OtlpTelemetry } from "../src/otlp.ts";
import {
  createTelemetryAdapterConformance,
  type TelemetryAdapterFixture,
} from "../src/testing/index.ts";

interface OtlpValue {
  readonly stringValue?: string;
  readonly boolValue?: boolean;
  readonly intValue?: string | number;
  readonly doubleValue?: number;
  readonly arrayValue?: { readonly values?: readonly OtlpValue[] };
}

interface OtlpAttribute {
  readonly key: string;
  readonly value: OtlpValue;
}

interface OtlpSpan {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OtlpAttribute[];
  readonly events: readonly { readonly name: string; readonly attributes: OtlpAttribute[] }[];
  readonly status: { readonly code: number };
}

interface OtlpLogRecord {
  readonly severityText: string;
  readonly body: OtlpValue;
  readonly spanId?: string;
  readonly attributes: readonly OtlpAttribute[];
}

interface OtlpDataPoint {
  readonly attributes: readonly OtlpAttribute[];
  readonly asDouble?: number;
  readonly asInt?: string | number;
  readonly sum?: number;
}

interface OtlpMetric {
  readonly name: string;
  readonly unit?: string;
  readonly sum?: { readonly dataPoints: readonly OtlpDataPoint[] };
  readonly gauge?: { readonly dataPoints: readonly OtlpDataPoint[] };
  readonly histogram?: { readonly dataPoints: readonly OtlpDataPoint[] };
}

interface Received {
  readonly spans: OtlpSpan[];
  readonly logs: OtlpLogRecord[];
  readonly metrics: Map<string, OtlpMetric>;
}

function scalar(value: OtlpValue): string | number | boolean {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  return value.doubleValue ?? 0;
}

function attributeValue(value: OtlpValue): AttributeValue {
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values ?? []).map(scalar) as AttributeValue;
  }
  return scalar(value);
}

function attributes(
  list: readonly OtlpAttribute[],
  hidden: readonly string[] = [],
): SpanAttributes {
  const result: SpanAttributes = {};
  for (const { key, value } of list) {
    if (!hidden.includes(key) && !key.startsWith("effect.")) result[key] = attributeValue(value);
  }
  return result;
}

function statusOf(span: OtlpSpan): SpanStatus {
  if (span.status.code !== 2) return { status: "ok" };
  const exception = span.events.find((event) => event.name === "exception");
  if (exception === undefined) return { status: "error" };
  const details = attributes(exception.attributes);
  return {
    status: "error",
    error: {
      name: String(details["exception.type"]),
      message: String(details["exception.message"]),
    },
  };
}

function normalizeSpans(received: Received): {
  spans: RecordedTelemetrySpan[];
  ids: Map<string, number>;
} {
  const started = received.spans.toSorted((a, b) =>
    Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)),
  );
  const ended = received.spans.toSorted((a, b) =>
    Number(BigInt(a.endTimeUnixNano) - BigInt(b.endTimeUnixNano)),
  );
  const ids = new Map(started.map((span, index) => [span.spanId, index + 1]));
  const spans = started.map((span): RecordedTelemetrySpan => ({
    id: ids.get(span.spanId)!,
    parentId: span.parentSpanId === undefined ? null : (ids.get(span.parentSpanId) ?? null),
    name: span.name,
    attributes: attributes(span.attributes),
    events: span.events
      .filter((event) => event.name !== "exception")
      .map((event) => ({ name: event.name, attributes: attributes(event.attributes) })),
    status: statusOf(span),
    settled: true,
    endSequence: ended.indexOf(span) + 1,
  }));
  return { spans, ids };
}

const severities: Readonly<Record<string, TelemetryLogSeverity>> = {
  Info: "info",
  Warn: "warn",
  Error: "error",
};

function normalizeLogs(received: Received): RecordedTelemetryLog[] {
  const { ids } = normalizeSpans(received);
  return received.logs.map((log) => ({
    spanId: log.spanId === undefined || log.spanId === "" ? null : (ids.get(log.spanId) ?? null),
    severity: severities[log.severityText] ?? "info",
    body: String(scalar(log.body)),
    attributes: attributes(log.attributes),
  }));
}

function normalizeMetrics(received: Received): RecordedTelemetryMetric[] {
  return [...received.metrics.values()].flatMap((metric) => {
    const [kind, points]: [TelemetryMetricKind, readonly OtlpDataPoint[]] =
      metric.histogram !== undefined
        ? ["histogram", metric.histogram.dataPoints]
        : metric.gauge !== undefined
          ? ["gauge", metric.gauge.dataPoints]
          : ["counter", metric.sum?.dataPoints ?? []];
    return points.map((point) => ({
      kind,
      name: metric.name,
      value: kind === "histogram" ? (point.sum ?? 0) : Number(point.asDouble ?? point.asInt ?? 0),
      ...(metric.unit === undefined || metric.unit === "1" ? {} : { unit: metric.unit }),
      attributes: attributes(point.attributes, ["unit"]),
    }));
  });
}

function receive(received: Received, path: string, body: string): void {
  const payload = JSON.parse(body);
  if (path === "/v1/traces") {
    for (const resource of payload.resourceSpans ?? []) {
      for (const scope of resource.scopeSpans ?? []) received.spans.push(...scope.spans);
    }
  } else if (path === "/v1/logs") {
    for (const resource of payload.resourceLogs ?? []) {
      for (const scope of resource.scopeLogs ?? []) received.logs.push(...scope.logRecords);
    }
  } else if (path === "/v1/metrics") {
    for (const resource of payload.resourceMetrics ?? []) {
      for (const scope of resource.scopeMetrics ?? []) {
        for (const metric of scope.metrics as OtlpMetric[])
          received.metrics.set(metric.name, metric);
      }
    }
  }
}

async function startCollector(): Promise<{ server: Server; endpoint: string; received: Received }> {
  const received: Received = { spans: [], logs: [], metrics: new Map() };
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      receive(received, request.url ?? "", body);
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, endpoint: `http://127.0.0.1:${port}`, received };
}

async function createFixture(): Promise<TelemetryAdapterFixture> {
  const { server, endpoint, received } = await startCollector();
  const runtime = ManagedRuntime.make(
    layer({ endpoint, serviceName: "msa-test", serviceVersion: "0.0.0" }),
  );
  const telemetry = await runtime.runPromise(Effect.service(OtlpTelemetry));
  const flushed = async (): Promise<Received> => {
    await runtime.runPromise(telemetry.flush);
    return received;
  };
  return {
    context: telemetry.context,
    getSpans: async () => normalizeSpans(await flushed()).spans,
    getLogs: async () => normalizeLogs(await flushed()),
    getMetrics: async () => normalizeMetrics(await flushed()),
    async [Symbol.asyncDispose]() {
      await runtime.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const conformance = createTelemetryAdapterConformance(createFixture);

describe("OTLP telemetry layer conformance", () => {
  for (const group of new Set(conformance.map((testCase) => testCase.group))) {
    describe(group, () => {
      for (const testCase of conformance.filter((candidate) => candidate.group === group)) {
        it(testCase.name, () => testCase.run());
      }
    });
  }
});

describe("OTLP telemetry layer", () => {
  it("sends the service name as the resource of every signal", async () => {
    const { server, endpoint } = await startCollector();
    const resources: string[] = [];
    server.prependListener("request", (request) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        const payload = JSON.parse(body);
        const list = payload.resourceSpans ?? payload.resourceLogs ?? payload.resourceMetrics ?? [];
        for (const entry of list) {
          const name = entry.resource.attributes.find(
            (attribute: OtlpAttribute) => attribute.key === "service.name",
          );
          resources.push(`${request.url} ${name?.value.stringValue}`);
        }
      });
    });
    const runtime = ManagedRuntime.make(
      layer({ endpoint, serviceName: "msa-resource", serviceVersion: "1.2.3" }),
    );
    await runtime.runPromise(
      Effect.gen(function* () {
        const telemetry = yield* OtlpTelemetry;
        yield* Effect.promise(() => telemetry.context.startSpan({ name: "resource" }, () => {}));
        telemetry.context.log({ severity: "info", body: "resource" });
        telemetry.context.recordMetric({ kind: "counter", name: "resource.count", value: 1 });
        yield* telemetry.flush;
      }),
    );
    await runtime.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(new Set(resources)).toEqual(
      new Set(["/v1/traces msa-resource", "/v1/logs msa-resource", "/v1/metrics msa-resource"]),
    );
  });
});
