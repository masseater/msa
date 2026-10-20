import type telemetryTypes from "@msa/telemetry/index.types";

export interface OpenSpan {
  readonly span: telemetryTypes.TelemetrySpan;
  end(status?: telemetryTypes.SpanStatus): void;
}

export function openSpan(
  context: telemetryTypes.TelemetryContext,
  options: telemetryTypes.SpanOptions,
): OpenSpan {
  const done = Promise.withResolvers<void>();
  let opened: telemetryTypes.TelemetrySpan | undefined;
  void context.startSpan(options, (span) => {
    opened = span;
    return done.promise;
  });
  const span = opened!;
  let ended = false;
  return {
    end(status) {
      if (ended) return;
      ended = true;
      if (status !== undefined) span.setStatus(status);
      done.resolve();
    },
    span,
  };
}
