import { Context, Effect, Layer, Metric } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  OtlpExporter,
  OtlpLogger,
  OtlpMetrics,
  OtlpSerialization,
  OtlpTracer,
} from "effect/observability";

import type contextTypes from "./context.ts";
import EffectTelemetry from "./otlp-effect-telemetry.ts";
import type otlpTypes from "./otlp.types.ts";

class OtlpTelemetry extends Context.Service<
  OtlpTelemetry,
  {
    readonly context: contextTypes.TelemetryContext;

    readonly flush: Effect.Effect<void>;
  }
>()("@msa/telemetry/otlp/OtlpTelemetry") {}

function exporters(options: otlpTypes.OtlpTelemetryOptions) {
  const base = options.endpoint.replace(/\/+$/u, "");
  const resource = { serviceName: options.serviceName, serviceVersion: options.serviceVersion };
  const traces = OtlpTracer.layer({ resource, url: `${base}/v1/traces` });
  const metrics = OtlpMetrics.layer({ resource, url: `${base}/v1/metrics` });
  const logs = OtlpLogger.layer({ mergeWithExisting: false, resource, url: `${base}/v1/logs` });
  return Layer.mergeAll(traces, metrics, logs).pipe(
    Layer.provideMerge(Layer.sync(Metric.MetricRegistry, () => new Map())),
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  );
}

const layer = (options: otlpTypes.OtlpTelemetryOptions): Layer.Layer<OtlpTelemetry> =>
  Layer.effect(
    OtlpTelemetry,
    Effect.gen(function* () {
      const services = yield* Effect.context<never>();
      const flusher = yield* OtlpExporter.Flusher;
      return { context: new EffectTelemetry(services).context(undefined), flush: flusher.flush };
    }),
  ).pipe(Layer.provide(exporters(options)));

const otlp = {
  OtlpTelemetry,
  layer,
};

export default otlp;
