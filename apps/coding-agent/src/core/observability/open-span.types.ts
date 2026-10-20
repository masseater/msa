import type telemetryTypes from "@msa/telemetry/index.types";

declare namespace openSpanTypes {
  interface OpenSpan {
    readonly span: telemetryTypes.TelemetrySpan;
    end(status?: telemetryTypes.SpanStatus): void;
  }
}

export type { openSpanTypes as default };
