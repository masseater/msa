import type telemetryTypes from "@msa/telemetry/index.types";

import type openSpanTypes from "./open-span.types.ts";

function openSpan(
  context: telemetryTypes.TelemetryContext,
  options: telemetryTypes.SpanOptions,
): openSpanTypes.OpenSpan {
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

const openSpanModule = {
  openSpan,
};

export default openSpanModule;
