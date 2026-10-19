import { Clock, Context, Effect, Exit, Layer, Metric, type Tracer } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  OtlpExporter,
  OtlpLogger,
  OtlpMetrics,
  OtlpSerialization,
  OtlpTracer,
} from "effect/observability";

import type {
  AttributeValue,
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetryLogRecord,
  TelemetryMetricRecord,
  TelemetrySpan,
} from "./context.ts";
import { NOOP_TELEMETRY_CONTEXT } from "./noop.ts";

export interface OtlpTelemetryOptions {
  /** Base URL of an OTLP/HTTP receiver; signals go to `/v1/traces`, `/v1/metrics`, and `/v1/logs`. */
  readonly endpoint: string;
  readonly serviceName: string;
  readonly serviceVersion: string;
}

export class OtlpTelemetry extends Context.Service<
  OtlpTelemetry,
  {
    readonly context: TelemetryContext;
    /** Sends every buffered span, metric, and log record now. */
    readonly flush: Effect.Effect<void>;
  }
>()("@msa/telemetry/otlp/OtlpTelemetry") {}

const SECOND_BOUNDARIES = [
  0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200,
] as const;

type Services = Context.Context<never>;

interface SpanState {
  readonly span: Tracer.Span;
  settled: boolean;
  status: SpanStatus | undefined;
}

function definedAttributes(attributes: SpanAttributes | undefined): Record<string, AttributeValue> {
  const copy: Record<string, AttributeValue> = {};
  if (attributes === undefined) return copy;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) copy[name] = Array.isArray(value) ? [...value] : value;
  }
  return copy;
}

function metricAttributes(attributes: SpanAttributes | undefined): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(definedAttributes(attributes))) {
    copy[name] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return copy;
}

function statusError(status: SpanStatus): Error {
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
  } catch {
    // The thrown value hides its fields; the span still records that the work failed.
  }
  return new Error("");
}

function exitOf(state: SpanState, failed: boolean, error: unknown): Exit.Exit<unknown, unknown> {
  if (state.status !== undefined) {
    return state.status.status === "ok" ? Exit.void : Exit.die(statusError(state.status));
  }
  return failed ? Exit.die(readableFailure(error)) : Exit.void;
}

const logBySeverity = {
  info: Effect.logInfo,
  warn: Effect.logWarning,
  error: Effect.logError,
} as const;

class EffectTelemetry {
  readonly #services: Services;
  readonly #runSync: <A>(effect: Effect.Effect<A>) => A;
  readonly #metrics = new Map<string, Metric.Metric<number, unknown>>();

  constructor(services: Services) {
    this.#services = services;
    this.#runSync = Effect.runSyncWith(services);
  }

  context(parent: SpanState | undefined): TelemetryContext {
    return {
      startSpan: (options, callback) => this.#startSpan(parent, options, callback),
      log: (record) => this.#log(parent, record),
      recordMetric: (record) => this.#recordMetric(parent, record),
    };
  }

  #now(): bigint {
    return Context.get(this.#services, Clock.Clock).currentTimeNanosUnsafe();
  }

  #startSpan<T>(
    parent: SpanState | undefined,
    options: SpanOptions,
    callback: (span: TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    if (parent?.settled === true) return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback);
    let state: SpanState;
    try {
      const span = this.#runSync(
        Effect.makeSpan(options.name, {
          parent: parent?.span,
          root: parent === undefined,
          attributes: definedAttributes(options.attributes),
        }),
      );
      state = { span, settled: false, status: undefined };
    } catch {
      return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback);
    }
    return this.#run(state, callback);
  }

  #run<T>(state: SpanState, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
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
    } catch {
      // A failed export must not change the outcome of the traced work.
    }
  }

  #span(state: SpanState): TelemetrySpan {
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
                    status: "error",
                    error: { name: status.error.name, message: status.error.message },
                  };
        });
      },
    };
  }

  #passively(state: SpanState | undefined, record: () => void): void {
    if (state?.settled === true) return;
    try {
      record();
    } catch {
      // Telemetry never fails the work it describes.
    }
  }

  #log(parent: SpanState | undefined, record: TelemetryLogRecord): void {
    this.#passively(parent, () => {
      const log = logBySeverity[record.severity](record.body).pipe(
        Effect.annotateLogs(definedAttributes(record.attributes)),
      );
      this.#runSync(parent === undefined ? log : Effect.withParentSpan(log, parent.span));
    });
  }

  #recordMetric(parent: SpanState | undefined, record: TelemetryMetricRecord): void {
    this.#passively(parent, () => {
      const metric = Metric.withAttributes(
        this.#metric(record),
        metricAttributes(record.attributes),
      );
      this.#runSync(Metric.update(metric, record.value));
    });
  }

  #metric(record: TelemetryMetricRecord): Metric.Metric<number, unknown> {
    const key = `${record.kind}:${record.name}`;
    const existing = this.#metrics.get(key);
    if (existing !== undefined) return existing;
    const options = {
      description: record.description,
      attributes: record.unit === undefined ? undefined : { unit: record.unit },
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

/**
 * The OTLP exporters of `effect/observability`, which only exist as unstable modules; so do
 * `@effect/opentelemetry`'s, which also need the `@opentelemetry/*` SDK this repository bans.
 * The signal layers share one `Flusher`, and the logger replaces the console logger.
 */
function exporters(options: OtlpTelemetryOptions) {
  const base = options.endpoint.replace(/\/+$/u, "");
  const resource = { serviceName: options.serviceName, serviceVersion: options.serviceVersion };
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- OtlpTracer (effect/unstable) is the only Effect OTLP trace exporter
  const traces = OtlpTracer.layer({ url: `${base}/v1/traces`, resource });
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- OtlpMetrics (effect/unstable) is the only Effect OTLP metric exporter
  const metrics = OtlpMetrics.layer({ url: `${base}/v1/metrics`, resource });
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- OtlpLogger (effect/unstable) is the only Effect OTLP log exporter
  const logs = OtlpLogger.layer({ url: `${base}/v1/logs`, resource, mergeWithExisting: false });
  return Layer.mergeAll(traces, metrics, logs).pipe(
    Layer.provideMerge(Layer.sync(Metric.MetricRegistry, () => new Map())),
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- OtlpSerialization (effect/unstable) encodes the OTLP payloads
    Layer.provide(OtlpSerialization.layerJson),
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- FetchHttpClient (effect/unstable) is the only Effect HTTP client
    Layer.provide(FetchHttpClient.layer),
  );
}

/** Exports the telemetry contract's spans, logs, and metrics to `options.endpoint` over OTLP/HTTP. */
export const layer = (options: OtlpTelemetryOptions): Layer.Layer<OtlpTelemetry> =>
  Layer.effect(
    OtlpTelemetry,
    Effect.gen(function* () {
      const services = yield* Effect.context<never>();
      // oxlint-disable-next-line effecttsgo/unstable-api-usage -- OtlpExporter (effect/unstable) owns the buffers to flush
      const flusher = yield* OtlpExporter.Flusher;
      return { context: new EffectTelemetry(services).context(undefined), flush: flusher.flush };
    }),
  ).pipe(Layer.provide(exporters(options)));
