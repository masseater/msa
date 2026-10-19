import type { SpanOptions, SpanStatus, TelemetryContext, TelemetrySpan } from "@msa/telemetry";

export interface OpenSpan {
  readonly span: TelemetrySpan;
  end(status?: SpanStatus): void;
}

export function openSpan(context: TelemetryContext, options: SpanOptions): OpenSpan {
  const done = Promise.withResolvers<void>();
  let opened: TelemetrySpan | undefined;
  void context.startSpan(options, (span) => {
    opened = span;
    return done.promise;
  });
  const span = opened!;
  let ended = false;
  return {
    span,
    end(status) {
      if (ended) return;
      ended = true;
      if (status !== undefined) span.setStatus(status);
      done.resolve();
    },
  };
}
