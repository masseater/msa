import telemetryModule from "@msa/telemetry";
import type telemetryTypes from "@msa/telemetry/index.types";
import otlp from "@msa/telemetry/otlp";
import {
  Cause,
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

import awaitingModule from "../awaiting.ts";
import lgtm from "./lgtm.ts";
import PodmanError from "./podman-error.ts";
import Telemetry from "./telemetry.ts";
import type telemetryTypesNs from "./telemetry.types.ts";

const { awaited, awaiting } = awaitingModule;

const { GRAFANA_URL, LGTM_CONTAINER, LGTM_OTLP_ENDPOINT, ensureLgtm, findPodman } = lgtm;
const { OtlpTelemetry, layer: otlpLayer } = otlp;
const { NOOP_TELEMETRY_CONTEXT } = telemetryModule;

function resolveDestination(
  inputs: telemetryTypesNs.TelemetryInputs,
): telemetryTypesNs.TelemetryDestination {
  const envEndpoint = inputs.envEndpoint?.trim();
  if (envEndpoint !== undefined && envEndpoint !== "")
    return { endpoint: envEndpoint, kind: "endpoint", source: "MSA_OTLP_ENDPOINT" };
  const settingsEndpoint = inputs.settingsEndpoint?.trim();
  if (settingsEndpoint !== undefined && settingsEndpoint !== "") {
    return { endpoint: settingsEndpoint, kind: "endpoint", source: "telemetry.otlpEndpoint" };
  }
  const podman = findPodman(inputs.path);
  if (podman !== undefined) return { kind: "lgtm", podman };
  return {
    kind: "off",
    reason:
      "podman not found; install podman or set MSA_OTLP_ENDPOINT to send traces, metrics, and logs",
  };
}
function describeTelemetry(status: telemetryTypesNs.TelemetryStatus): string {
  const { destination, state } = status;
  if (destination.kind === "off") return `Telemetry off: ${destination.reason}`;
  const target =
    destination.kind === "lgtm"
      ? `Grafana ${GRAFANA_URL} (podman ${LGTM_CONTAINER})`
      : `OTLP ${destination.endpoint} (${destination.source})`;
  if (state.kind === "failed") return `Telemetry: ${target} failed: ${state.reason}`;
  return state.kind === "starting" ? `Telemetry: ${target}, connecting` : `Telemetry: ${target}`;
}
function forwardingContext(target: {
  current: telemetryTypes.TelemetryContext;
}): telemetryTypes.TelemetryContext {
  return {
    log: (record) => target.current.log(record),
    recordMetric: (record) => target.current.recordMetric(record),
    startSpan: (options, callback) => target.current.startSpan(options, callback),
  };
}
function exportPipeline(
  endpoint: string,
  version: string,
  scope: Scope.Scope,
): Effect.Effect<telemetryTypes.TelemetryContext> {
  return Layer.buildWithScope(
    otlpLayer({ endpoint, serviceName: "msa", serviceVersion: version }),
    scope,
  ).pipe(Effect.map((services) => Context.get(services, OtlpTelemetry).context));
}
const SHUTDOWN_TIMEOUT = Duration.seconds(5);
function startTelemetry(
  inputs: telemetryTypesNs.TelemetryInputs,
): Promise<telemetryTypesNs.TelemetryHandle> {
  return Effect.runPromise(
    awaiting(function* () {
      const runtime = ManagedRuntime.make(layer(inputs));
      const telemetry = yield* awaited(runtime.runPromise(Effect.service(Telemetry)));
      return yield* awaited({
        context: telemetry.context,
        dispose: () =>
          Effect.runPromise(
            Effect.promise(() => runtime.dispose()).pipe(Effect.timeoutOption(SHUTDOWN_TIMEOUT)),
          ).then(() => undefined),
        status: () => Effect.runSync(telemetry.status),
      });
    }),
  );
}
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
const layer = (inputs: telemetryTypesNs.TelemetryInputs): Layer.Layer<Telemetry> =>
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
      const state = yield* Ref.make<telemetryTypesNs.ExportState>({ kind: "starting" });
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
          const failure = exit.cause.reasons.find(Cause.isFailReason);
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

const telemetrySupport = {
  describeTelemetry,
  layer,
  resolveDestination,
  startTelemetry,
};

export default telemetrySupport;
