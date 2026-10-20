import type contextTypes from "./context.ts";

function startNoopSpan<T>(
  _options: contextTypes.SpanOptions,
  callback: (span: contextTypes.TelemetrySpan) => T | Promise<T>,
): Promise<T> {
  try {
    return Promise.resolve(callback(noopTelemetrySpan));
  } catch (error) {
    return Promise.reject(error);
  }
}

const noopTelemetrySpan: contextTypes.TelemetrySpan = {
  addEvent: () => {},
  log: () => {},
  recordMetric: () => {},
  setAttributes: () => {},
  setStatus: () => {},
  startSpan: startNoopSpan,
};
Object.freeze(noopTelemetrySpan);

const NOOP_TELEMETRY_CONTEXT: contextTypes.TelemetryContext = noopTelemetrySpan;

const noop = {
  NOOP_TELEMETRY_CONTEXT,
};

export default noop;
