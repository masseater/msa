import type contextTypes from "./context.ts";
import type InMemoryTelemetryContextClass from "./memory.ts";

declare namespace memoryTypes {
  interface RecordedTelemetryEvent {
    readonly name: string;
    readonly attributes: Readonly<contextTypes.SpanAttributes>;
  }

  interface RecordedTelemetrySpan {
    readonly id: number;
    readonly parentId: number | null;
    readonly name: string;
    readonly attributes: Readonly<contextTypes.SpanAttributes>;
    readonly events: readonly RecordedTelemetryEvent[];
    readonly status: contextTypes.SpanStatus;
    readonly settled: boolean;
    readonly endSequence?: number;
  }

  interface RecordedTelemetryLog {
    readonly spanId: number | null;
    readonly severity: contextTypes.TelemetryLogSeverity;
    readonly body: string;
    readonly attributes: Readonly<contextTypes.SpanAttributes>;
  }

  interface RecordedTelemetryMetric {
    readonly kind: contextTypes.TelemetryMetricKind;
    readonly name: string;
    readonly value: number;
    readonly unit?: string;
    readonly attributes: Readonly<contextTypes.SpanAttributes>;
  }

  type InMemoryTelemetryContext = InMemoryTelemetryContextClass;
}

export type { memoryTypes as default };
