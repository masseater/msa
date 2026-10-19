export type AttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export interface SpanAttributes {
  [name: string]: AttributeValue | undefined;
}

export interface SpanOptions {
  name: string;
  attributes?: SpanAttributes;
}

export type SpanStatus =
  | { status: "ok" }
  | { status: "error"; error?: { name: string; message: string } };

export type TelemetryLogSeverity = "info" | "warn" | "error";

export interface TelemetryLogRecord {
  readonly severity: TelemetryLogSeverity;
  readonly body: string;
  readonly attributes?: SpanAttributes;
}

export type TelemetryMetricKind = "counter" | "histogram" | "gauge";

export interface TelemetryMetricRecord {
  readonly kind: TelemetryMetricKind;
  readonly name: string;
  readonly value: number;
  readonly unit?: string;
  readonly description?: string;
  readonly attributes?: SpanAttributes;
}

export interface TelemetryContext {
  startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T>;
  log(record: TelemetryLogRecord): void;
  recordMetric(record: TelemetryMetricRecord): void;
}

export interface TelemetrySpan extends TelemetryContext {
  addEvent(name: string, attributes?: SpanAttributes): void;
  setAttributes(attributes: SpanAttributes): void;
  setStatus(status: SpanStatus): void;
}
