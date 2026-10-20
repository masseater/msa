declare namespace otlpRecordsTypes {
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

  interface Payload {
    readonly resourceSpans?: readonly ResourceEntry<{
      readonly scopeSpans?: readonly { readonly spans?: OtlpSpan[] }[];
    }>[];
    readonly resourceLogs?: readonly ResourceEntry<{
      readonly scopeLogs?: readonly { readonly logRecords?: OtlpLogRecord[] }[];
    }>[];
    readonly resourceMetrics?: readonly ResourceEntry<{
      readonly scopeMetrics?: readonly { readonly metrics?: OtlpMetric[] }[];
    }>[];
  }

  type ResourceEntry<T> = T & {
    readonly resource?: { readonly attributes: readonly OtlpAttribute[] };
  };
}

export type { otlpRecordsTypes as default };
