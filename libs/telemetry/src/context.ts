declare namespace contextTypes {
  type AttributeValue =
    | string
    | number
    | boolean
    | readonly string[]
    | readonly number[]
    | readonly boolean[];

  interface SpanAttributes {
    [name: string]: AttributeValue | undefined;
  }

  interface SpanOptions {
    name: string;
    attributes?: SpanAttributes;
  }

  type SpanStatus =
    | { status: "ok" }
    | { status: "error"; error?: { name: string; message: string } };

  type TelemetryLogSeverity = "info" | "warn" | "error";

  interface TelemetryLogRecord {
    readonly severity: TelemetryLogSeverity;
    readonly body: string;
    readonly attributes?: SpanAttributes;
  }

  type TelemetryMetricKind = "counter" | "histogram" | "gauge";

  interface TelemetryMetricRecord {
    readonly kind: TelemetryMetricKind;
    readonly name: string;
    readonly value: number;
    readonly unit?: string;
    readonly description?: string;
    readonly attributes?: SpanAttributes;
  }

  interface TelemetryContext {
    startSpan<T>(
      options: SpanOptions,
      callback: (span: TelemetrySpan) => T | Promise<T>,
    ): Promise<T>;
    log(record: TelemetryLogRecord): void;
    recordMetric(record: TelemetryMetricRecord): void;
  }

  interface TelemetrySpan extends TelemetryContext {
    addEvent(name: string, attributes?: SpanAttributes): void;
    setAttributes(attributes: SpanAttributes): void;
    setStatus(status: SpanStatus): void;
  }
}

export type { contextTypes as default };
