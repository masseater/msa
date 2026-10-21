import { Clock, Context, Effect, Exit, Metric, type Tracer } from "effect";

import type contextTypes from "./context.ts";
import noop from "./noop.ts";

const { NOOP_TELEMETRY_CONTEXT } = noop;

const SECOND_BOUNDARIES = [
  0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200,
] as const;

type Services = Context.Context<never>;

interface SpanState {
  readonly span: Tracer.Span;
  settled: boolean;
  status: contextTypes.SpanStatus | undefined;
}

function definedAttributes(
  attributes: contextTypes.SpanAttributes | undefined,
): Record<string, contextTypes.AttributeValue> {
  const copy: Record<string, contextTypes.AttributeValue> = {};
  if (attributes === undefined) return copy;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) copy[name] = Array.isArray(value) ? [...value] : value;
  }
  return copy;
}

function metricAttributes(
  attributes: contextTypes.SpanAttributes | undefined,
): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(definedAttributes(attributes))) {
    copy[name] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return copy;
}

function statusError(status: contextTypes.SpanStatus): Error {
  const error = new Error(status.status === "error" ? (status.error?.message ?? "") : "");
  if (status.status === "error" && status.error !== undefined) error.name = status.error.name;
  return error;
}

function readableFailure(error: unknown): Error {
  try {
    if (error instanceof Error) {
      const copy = new Error(error.message);
      copy.name = error.name;
      if (error.stack !== undefined) copy.stack = error.stack;
      return copy;
    }
  } catch {}
  return new Error("");
}

function exitOf(state: SpanState, failed: boolean, error: unknown): Exit.Exit<unknown, unknown> {
  if (state.status !== undefined) {
    return state.status.status === "ok" ? Exit.void : Exit.die(statusError(state.status));
  }
  return failed ? Exit.die(readableFailure(error)) : Exit.void;
}

const logBySeverity = {
  error: Effect.logError,
  info: Effect.logInfo,
  warn: Effect.logWarning,
} as const;

class EffectTelemetry {
  readonly #services: Services;
  readonly #runSync: <A>(effect: Effect.Effect<A>) => A;
  readonly #metrics = new Map<string, Metric.Metric<number, unknown>>();

  constructor(services: Services) {
    this.#services = services;
    this.#runSync = Effect.runSyncWith(services);
  }

  context(parent: SpanState | undefined): contextTypes.TelemetryContext {
    return {
      log: (record) => this.#log(parent, record),
      recordMetric: (record) => this.#recordMetric(parent, record),
      startSpan: (options, callback) => this.#startSpan(parent, options, callback),
    };
  }

  #now(): bigint {
    return Context.get(this.#services, Clock.Clock).currentTimeNanosUnsafe();
  }

  #startSpan<T>(
    parent: SpanState | undefined,
    options: contextTypes.SpanOptions,
    callback: (span: contextTypes.TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    if (parent?.settled === true) return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback);
    let state: SpanState;
    try {
      const span = this.#runSync(
        Effect.makeSpan(options.name, {
          attributes: definedAttributes(options.attributes),
          parent: parent?.span,
          root: parent === undefined,
        }),
      );
      state = { settled: false, span, status: undefined };
    } catch {
      return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback);
    }
    return this.#run(state, callback);
  }

  #run<T>(
    state: SpanState,
    callback: (span: contextTypes.TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    let result: T | Promise<T>;
    try {
      result = callback(this.#span(state));
    } catch (error) {
      this.#settle(state, true, error);
      return Promise.reject(error);
    }
    return Promise.resolve(result).then(
      (value) => {
        this.#settle(state, false, undefined);
        return value;
      },
      (error: unknown) => {
        this.#settle(state, true, error);
        throw error;
      },
    );
  }

  #settle(state: SpanState, failed: boolean, error: unknown): void {
    if (state.settled) return;
    state.settled = true;
    try {
      state.span.end(this.#now(), exitOf(state, failed, error));
    } catch {}
  }

  #span(state: SpanState): contextTypes.TelemetrySpan {
    return {
      ...this.context(state),
      addEvent: (name, attributes) => {
        this.#passively(state, () => {
          state.span.event(name, this.#now(), definedAttributes(attributes));
        });
      },
      setAttributes: (attributes) => {
        this.#passively(state, () => {
          for (const [name, value] of Object.entries(definedAttributes(attributes))) {
            state.span.attribute(name, value);
          }
        });
      },
      setStatus: (status) => {
        this.#passively(state, () => {
          state.status =
            status.status === "ok"
              ? { status: "ok" }
              : status.error === undefined
                ? { status: "error" }
                : {
                    error: { message: status.error.message, name: status.error.name },
                    status: "error",
                  };
        });
      },
    };
  }

  #passively(state: SpanState | undefined, record: () => void): void {
    if (state?.settled === true) return;
    try {
      record();
    } catch {}
  }

  #log(parent: SpanState | undefined, record: contextTypes.TelemetryLogRecord): void {
    this.#passively(parent, () => {
      const log = logBySeverity[record.severity](record.body).pipe(
        Effect.annotateLogs(definedAttributes(record.attributes)),
      );
      this.#runSync(parent === undefined ? log : Effect.withParentSpan(log, parent.span));
    });
  }

  #recordMetric(parent: SpanState | undefined, record: contextTypes.TelemetryMetricRecord): void {
    this.#passively(parent, () => {
      const metric = Metric.withAttributes(
        this.#metric(record),
        metricAttributes(record.attributes),
      );
      this.#runSync(Metric.update(metric, record.value));
    });
  }

  #metric(record: contextTypes.TelemetryMetricRecord): Metric.Metric<number, unknown> {
    const key = `${record.kind}:${record.name}`;
    const existing = this.#metrics.get(key);
    if (existing !== undefined) return existing;
    const options = {
      attributes: record.unit === undefined ? undefined : { unit: record.unit },
      description: record.description,
    };
    const created: Metric.Metric<number, unknown> =
      record.kind === "counter"
        ? Metric.counter(record.name, { ...options, incremental: true })
        : record.kind === "histogram"
          ? Metric.histogram(record.name, { ...options, boundaries: SECOND_BOUNDARIES })
          : Metric.gauge(record.name, options);
    this.#metrics.set(key, created);
    return created;
  }
}

export default EffectTelemetry;
