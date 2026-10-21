import type contextTypes from "./context.ts";
import type memoryTypes from "./memory.types.ts";
import noop from "./noop.ts";

const { NOOP_TELEMETRY_CONTEXT } = noop;

interface MutableRecordedTelemetryEvent {
  name: string;
  attributes: contextTypes.SpanAttributes;
}

interface MutableRecordedTelemetrySpan {
  id: number;
  parentId: number | null;
  name: string;
  attributes: contextTypes.SpanAttributes;
  events: MutableRecordedTelemetryEvent[];
  status: contextTypes.SpanStatus;
  explicitStatus: boolean;
  settled: boolean;
  endSequence?: number;
}

interface InMemoryTelemetryState {
  spans: MutableRecordedTelemetrySpan[];
  logs: memoryTypes.RecordedTelemetryLog[];
  metrics: memoryTypes.RecordedTelemetryMetric[];
  nextSpanId: number;
  nextEndSequence: number;
}

function copyAttributeValue(value: contextTypes.AttributeValue): contextTypes.AttributeValue {
  return Array.isArray(value) ? ([...value] as contextTypes.AttributeValue) : value;
}

function copyAttributes(attributes?: contextTypes.SpanAttributes): contextTypes.SpanAttributes {
  const copy: contextTypes.SpanAttributes = {};
  if (attributes === undefined) return copy;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) copy[name] = copyAttributeValue(value);
  }
  return copy;
}

function mergeAttributes(
  current: contextTypes.SpanAttributes,
  attributes: contextTypes.SpanAttributes,
): contextTypes.SpanAttributes {
  const merged = copyAttributes(current);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) merged[name] = copyAttributeValue(value);
  }
  return merged;
}

function copyStatus(status: contextTypes.SpanStatus): contextTypes.SpanStatus {
  if (status.status === "ok") return { status: "ok" };
  return status.error === undefined
    ? { status: "error" }
    : { error: { message: status.error.message, name: status.error.name }, status: "error" };
}

function automaticErrorStatus(error: unknown): contextTypes.SpanStatus {
  try {
    if (error instanceof Error) {
      return { error: { message: error.message, name: error.name }, status: "error" };
    }
  } catch {
    return { status: "error" };
  }
  return { status: "error" };
}

function settleSpan(
  state: InMemoryTelemetryState,
  span: MutableRecordedTelemetrySpan,
  failed: boolean,
  error?: unknown,
): void {
  if (span.settled) return;
  if (failed && !span.explicitStatus) span.status = automaticErrorStatus(error);
  span.settled = true;
  span.endSequence = state.nextEndSequence++;
}

function createSpan(
  state: InMemoryTelemetryState,
  parent: MutableRecordedTelemetrySpan | undefined,
  options: contextTypes.SpanOptions,
): MutableRecordedTelemetrySpan {
  const name = options.name;
  const attributes = copyAttributes(options.attributes);
  return {
    attributes,
    events: [],
    explicitStatus: false,
    id: state.nextSpanId++,
    name,
    parentId: parent?.id ?? null,
    settled: false,
    status: { status: "ok" },
  };
}

function recordPassively(recordedSpan: MutableRecordedTelemetrySpan, record: () => void): boolean {
  if (recordedSpan.settled) return false;
  try {
    record();
    return true;
  } catch {
    return false;
  }
}

function recordLog(
  state: InMemoryTelemetryState,
  spanId: number | null,
  record: contextTypes.TelemetryLogRecord,
): void {
  try {
    const log: memoryTypes.RecordedTelemetryLog = {
      attributes: copyAttributes(record.attributes),
      body: record.body,
      severity: record.severity,
      spanId,
    };
    state.logs.push(log);
  } catch {}
}

function recordMetric(
  state: InMemoryTelemetryState,
  record: contextTypes.TelemetryMetricRecord,
): void {
  try {
    const metric: memoryTypes.RecordedTelemetryMetric = {
      kind: record.kind,
      name: record.name,
      value: record.value,
      ...(record.unit === undefined ? {} : { unit: record.unit }),
      attributes: copyAttributes(record.attributes),
    };
    state.metrics.push(metric);
  } catch {}
}

function createRecordingSpan(
  state: InMemoryTelemetryState,
  recordedSpan: MutableRecordedTelemetrySpan,
): contextTypes.TelemetrySpan {
  return {
    addEvent(name, attributes) {
      recordPassively(recordedSpan, () => {
        recordedSpan.events.push({ attributes: copyAttributes(attributes), name });
      });
    },
    log(record) {
      if (!recordedSpan.settled) recordLog(state, recordedSpan.id, record);
    },
    recordMetric(record) {
      if (!recordedSpan.settled) recordMetric(state, record);
    },
    setAttributes(attributes) {
      recordPassively(recordedSpan, () => {
        recordedSpan.attributes = mergeAttributes(recordedSpan.attributes, attributes);
      });
    },
    setStatus(status) {
      recordPassively(recordedSpan, () => {
        recordedSpan.status = copyStatus(status);
        recordedSpan.explicitStatus = true;
      });
    },
    startSpan: <Result>(
      childOptions: contextTypes.SpanOptions,
      childCallback: (child: contextTypes.TelemetrySpan) => Result | Promise<Result>,
    ) => startInMemorySpan(state, recordedSpan, childOptions, childCallback),
  };
}

function runRecordedCallback<T>(
  state: InMemoryTelemetryState,
  recordedSpan: MutableRecordedTelemetrySpan,
  callback: (span: contextTypes.TelemetrySpan) => T | Promise<T>,
): Promise<T> {
  let result: T | Promise<T>;
  try {
    result = callback(createRecordingSpan(state, recordedSpan));
  } catch (error) {
    settleSpan(state, recordedSpan, true, error);
    return Promise.reject(error);
  }

  return Promise.resolve(result).then(
    (value) => {
      settleSpan(state, recordedSpan, false);
      return value;
    },
    (error: unknown) => {
      settleSpan(state, recordedSpan, true, error);
      throw error;
    },
  );
}

function startInMemorySpan<T>(
  state: InMemoryTelemetryState,
  parent: MutableRecordedTelemetrySpan | undefined,
  options: contextTypes.SpanOptions,
  callback: (span: contextTypes.TelemetrySpan) => T | Promise<T>,
): Promise<T> {
  if (parent?.settled === true) return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback);

  let recordedSpan: MutableRecordedTelemetrySpan;
  try {
    recordedSpan = createSpan(state, parent, options);
    state.spans.push(recordedSpan);
  } catch {
    return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback);
  }

  return runRecordedCallback(state, recordedSpan, callback);
}

export default class InMemoryTelemetryContext implements contextTypes.TelemetryContext {
  private readonly state: InMemoryTelemetryState = {
    logs: [],
    metrics: [],
    nextEndSequence: 1,
    nextSpanId: 1,
    spans: [],
  };

  startSpan<T>(
    options: contextTypes.SpanOptions,
    callback: (span: contextTypes.TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    return startInMemorySpan(this.state, undefined, options, callback);
  }

  log(record: contextTypes.TelemetryLogRecord): void {
    recordLog(this.state, null, record);
  }

  recordMetric(record: contextTypes.TelemetryMetricRecord): void {
    recordMetric(this.state, record);
  }

  getLogs(): readonly memoryTypes.RecordedTelemetryLog[] {
    return this.state.logs.map((log) => ({ ...log, attributes: copyAttributes(log.attributes) }));
  }

  getMetrics(): readonly memoryTypes.RecordedTelemetryMetric[] {
    return this.state.metrics.map((metric) => ({
      ...metric,
      attributes: copyAttributes(metric.attributes),
    }));
  }

  getSpans(): readonly memoryTypes.RecordedTelemetrySpan[] {
    return this.state.spans.map((span) => ({
      attributes: copyAttributes(span.attributes),
      events: span.events.map((event) => ({
        attributes: copyAttributes(event.attributes),
        name: event.name,
      })),
      id: span.id,
      name: span.name,
      parentId: span.parentId,
      settled: span.settled,
      status: copyStatus(span.status),
      ...(span.endSequence === undefined ? {} : { endSequence: span.endSequence }),
    }));
  }
}
