import { NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@msa/telemetry";
import { OtlpTelemetry, layer as otlpLayer } from "@msa/telemetry/otlp";
import {
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Ref,
  Schedule,
  Scope,
} from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

import {
  ensureLgtm,
  findPodman,
  GRAFANA_URL,
  LGTM_CONTAINER,
  LGTM_OTLP_ENDPOINT,
  PodmanError,
} from "./lgtm.ts";

export type TelemetryDestination =
  | { readonly kind: "endpoint"; readonly endpoint: string; readonly source: string }
  | { readonly kind: "lgtm"; readonly podman: string }
  | { readonly kind: "off"; readonly reason: string };

export interface TelemetryInputs {
  /** `MSA_OTLP_ENDPOINT` */
  readonly envEndpoint: string | undefined;
  /** `telemetry.otlpEndpoint` */
  readonly settingsEndpoint: string | undefined;
  /** `PATH`, searched for podman */
  readonly path: string | undefined;
  readonly version: string;
}

export function resolveDestination(inputs: TelemetryInputs): TelemetryDestination {
  const envEndpoint = inputs.envEndpoint?.trim();
  if (envEndpoint) return { kind: "endpoint", endpoint: envEndpoint, source: "MSA_OTLP_ENDPOINT" };
  const settingsEndpoint = inputs.settingsEndpoint?.trim();
  if (settingsEndpoint) {
    return { kind: "endpoint", endpoint: settingsEndpoint, source: "telemetry.otlpEndpoint" };
  }
  const podman = findPodman(inputs.path);
  if (podman !== undefined) return { kind: "lgtm", podman };
  return {
    kind: "off",
    reason:
      "podman not found; install podman or set MSA_OTLP_ENDPOINT to send traces, metrics, and logs",
  };
}

export type ExportState =
  | { readonly kind: "exporting" }
  | { readonly kind: "starting" }
  | { readonly kind: "failed"; readonly reason: string };

export interface TelemetryStatus {
  readonly destination: TelemetryDestination;
  readonly state: ExportState;
}

export class Telemetry extends Context.Service<
  Telemetry,
  {
    readonly context: TelemetryContext;
    readonly status: Effect.Effect<TelemetryStatus>;
  }
>()("@msa/coding-agent/core/observability/telemetry") {}

/** The one line printed at startup and shown by /status. */
export function describeTelemetry(status: TelemetryStatus): string {
  const { destination, state } = status;
  if (destination.kind === "off") return `Telemetry off: ${destination.reason}`;
  const target =
    destination.kind === "lgtm"
      ? `Grafana ${GRAFANA_URL} (podman ${LGTM_CONTAINER})`
      : `OTLP ${destination.endpoint} (${destination.source})`;
  if (state.kind === "failed") return `Telemetry: ${target} failed: ${state.reason}`;
  return state.kind === "starting" ? `Telemetry: ${target}, connecting` : `Telemetry: ${target}`;
}

/**
 * Hands out a context that records nothing until the export pipeline is ready,
 * so spans started before the container accepts OTLP are not queued for a dead endpoint.
 */
function forwardingContext(target: { current: TelemetryContext }): TelemetryContext {
  return {
    startSpan: (options, callback) => target.current.startSpan(options, callback),
    log: (record) => target.current.log(record),
    recordMetric: (record) => target.current.recordMetric(record),
  };
}

function exportPipeline(
  endpoint: string,
  version: string,
  scope: Scope.Scope,
): Effect.Effect<TelemetryContext> {
  return Layer.buildWithScope(
    otlpLayer({ endpoint, serviceName: "msa", serviceVersion: version }),
    scope,
  ).pipe(Effect.map((services) => Context.get(services, OtlpTelemetry).context));
}

/** The process-wide telemetry msa starts once and flushes when it exits. */
export interface TelemetryHandle {
  readonly context: TelemetryContext;
  status(): TelemetryStatus;
  dispose(): Promise<void>;
}

const SHUTDOWN_TIMEOUT = Duration.seconds(5);

export async function startTelemetry(inputs: TelemetryInputs): Promise<TelemetryHandle> {
  const runtime = ManagedRuntime.make(layer(inputs));
  const telemetry = await runtime.runPromise(Effect.service(Telemetry));
  return {
    context: telemetry.context,
    status: () => Effect.runSync(telemetry.status),
    dispose: () =>
      Effect.runPromise(
        Effect.promise(() => runtime.dispose()).pipe(Effect.timeoutOption(SHUTDOWN_TIMEOUT)),
      ).then(() => undefined),
  };
}

/** The receiver answers any request once the collector is up; the status code does not matter. */
const receiverReady = HttpClient.get(`${LGTM_OTLP_ENDPOINT}/v1/traces`).pipe(
  Effect.asVoid,
  Effect.retry({ schedule: Schedule.spaced(Duration.seconds(1)), times: 600 }),
  Effect.mapError(
    () =>
      new PodmanError({
        message: `${LGTM_OTLP_ENDPOINT} did not answer within 10 minutes`,
      }),
  ),
);

/** Provides `Telemetry`: OTLP to the configured endpoint, else the podman otel-lgtm container, else nothing. */
export const layer = (inputs: TelemetryInputs): Layer.Layer<Telemetry> =>
  Layer.effect(
    Telemetry,
    Effect.gen(function* () {
      const destination = resolveDestination(inputs);
      const scope = yield* Scope.Scope;
      if (destination.kind === "off") {
        return {
          context: NOOP_TELEMETRY_CONTEXT,
          status: Effect.succeed({ destination, state: { kind: "exporting" } as const }),
        };
      }
      if (destination.kind === "endpoint") {
        const context = yield* exportPipeline(destination.endpoint, inputs.version, scope);
        return {
          context,
          status: Effect.succeed({ destination, state: { kind: "exporting" } as const }),
        };
      }
      const state = yield* Ref.make<ExportState>({ kind: "starting" });
      const target = { current: NOOP_TELEMETRY_CONTEXT };
      yield* ensureLgtm(destination.podman).pipe(
        Effect.andThen(receiverReady),
        Effect.andThen(exportPipeline(LGTM_OTLP_ENDPOINT, inputs.version, scope)),
        Effect.exit,
        Effect.flatMap((exit) => {
          if (Exit.isSuccess(exit)) {
            target.current = exit.value;
            return Ref.set(state, { kind: "exporting" });
          }
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
          const reason = failure === undefined ? "interrupted" : failure.error.message;
          return Ref.set(state, { kind: "failed", reason });
        }),
        Effect.forkIn(scope),
      );
      return {
        context: forwardingContext(target),
        status: Effect.map(Ref.get(state), (current) => ({ destination, state: current })),
      };
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
