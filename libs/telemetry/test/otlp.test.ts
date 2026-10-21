import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Context, Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { HttpEffect, HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { describe, expect, it } from "vite-plus/test";

import otlp from "../src/otlp.ts";
import testing from "../src/testing/index.ts";
import type testingTypes from "../src/testing/index.types.ts";
import otlpRecords from "./otlp-records.ts";
import type otlpRecordsTypes from "./otlp-records.types.ts";

const { OtlpTelemetry, layer } = otlp;
const { createTelemetryAdapterConformance } = testing;

const { normalizeLogs, normalizeMetrics, normalizeSpans, receive } = otlpRecords;

interface Collector {
  readonly endpoint: string;
  readonly received: otlpRecordsTypes.Received;
  readonly close: Effect.Effect<void>;
}

type Listener = (path: string, payload: otlpRecordsTypes.Payload) => void;

const respond = (listener: Listener) =>
  HttpEffect.fromWebHandler((request) =>
    Effect.runPromise(
      Effect.map(
        Effect.promise(() => request.text()),
        (body) => {
          listener(new URL(request.url).pathname, JSON.parse(body) as otlpRecordsTypes.Payload);
          return new Response("{}", { headers: { "content-type": "application/json" } });
        },
      ),
    ),
  );

const startCollector = (onPayload: Listener = () => {}): Effect.Effect<Collector> =>
  Effect.gen(function* () {
    const received: otlpRecordsTypes.Received = { logs: [], metrics: new Map(), spans: [] };
    const scope = yield* Scope.make();
    const serving = HttpServer.serve(
      respond((path, payload) => {
        onPayload(path, payload);
        receive(received, path, payload);
      }),
    ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
    const services = yield* Effect.orDie(Layer.buildWithScope(serving, scope));
    const { address } = Context.get(services, HttpServer.HttpServer);
    if (NetAddress.isUnixPathAddress(address))
      return yield* Effect.die("collector bound to a path");
    return {
      close: Scope.close(scope, Exit.void),
      endpoint: `http://127.0.0.1:${address.port}`,
      received,
    };
  });

const makeFixture = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const { close, endpoint, received } = yield* startCollector();
  const runtime = ManagedRuntime.make(
    layer({ endpoint, serviceName: "msa-test", serviceVersion: "0.0.0" }),
  );
  const telemetry = yield* Effect.promise(() => runtime.runPromise(Effect.service(OtlpTelemetry)));
  const flushed = Effect.as(
    Effect.promise(() => runtime.runPromise(telemetry.flush)),
    received,
  );
  const fixture: testingTypes.TelemetryAdapterFixture = {
    [Symbol.asyncDispose]: () =>
      runPromise(
        Effect.andThen(
          Effect.promise(() => runtime.dispose()),
          close,
        ),
      ),
    context: telemetry.context,
    getLogs: () => runPromise(Effect.map(flushed, normalizeLogs)),
    getMetrics: () => runPromise(Effect.map(flushed, normalizeMetrics)),
    getSpans: () => runPromise(Effect.map(flushed, (result) => normalizeSpans(result).spans)),
  };
  return fixture;
});

const conformance = createTelemetryAdapterConformance(() => Effect.runPromise(makeFixture));

describe("OTLP telemetry layer conformance", () => {
  for (const group of new Set(conformance.map((testCase) => testCase.group))) {
    describe(group, () => {
      for (const testCase of conformance.filter((candidate) => candidate.group === group)) {
        it(testCase.name, () => testCase.run());
      }
    });
  }
});

const serviceNames = (path: string, payload: otlpRecordsTypes.Payload): string[] =>
  (payload.resourceSpans ?? payload.resourceLogs ?? payload.resourceMetrics ?? []).map(
    (entry) =>
      `${path} ${
        entry.resource?.attributes.find((attribute) => attribute.key === "service.name")?.value
          .stringValue
      }`,
  );

const sendEverySignal = Effect.gen(function* () {
  const resources: string[] = [];
  const collector = yield* startCollector((path, payload) => {
    resources.push(...serviceNames(path, payload));
  });
  const runtime = ManagedRuntime.make(
    layer({ endpoint: collector.endpoint, serviceName: "msa-resource", serviceVersion: "1.2.3" }),
  );
  yield* Effect.promise(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        const telemetry = yield* OtlpTelemetry;
        yield* Effect.promise(() => telemetry.context.startSpan({ name: "resource" }, () => {}));
        telemetry.context.log({ body: "resource", severity: "info" });
        telemetry.context.recordMetric({ kind: "counter", name: "resource.count", value: 1 });
        yield* telemetry.flush;
      }),
    ),
  );
  yield* Effect.promise(() => runtime.dispose());
  yield* collector.close;
  return new Set(resources);
});

describe("OTLP telemetry layer", () => {
  it("sends the service name as the resource of every signal", () =>
    Effect.runPromise(
      Effect.map(sendEverySignal, (resources) => {
        expect(resources).toEqual(
          new Set(["/v1/traces msa-resource", "/v1/logs msa-resource", "/v1/metrics msa-resource"]),
        );
      }),
    ));
});
