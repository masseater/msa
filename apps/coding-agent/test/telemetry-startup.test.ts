import { NOOP_TELEMETRY_CONTEXT } from "@msa/telemetry";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  describeTelemetry,
  resolveDestination,
  startTelemetry,
} from "../src/core/observability/telemetry.ts";

const {
  awaited,
  changeMode,
  closeServers,
  joinPath,
  listen,
  makeTempDir,
  readBody,
  removeDirs,
  runTest,
  writeTextFile,
} = testing;

const directories: string[] = [];

const emptyDirectory = Effect.fn("emptyDirectory")(function* () {
  const directory = yield* makeTempDir("msa-telemetry-");
  directories.push(directory);
  return directory;
});

afterEach(() => runTest(Effect.andThen(closeServers, removeDirs(directories.splice(0)))));

const podmanOnPath = Effect.fn("podmanOnPath")(function* () {
  const bin = yield* emptyDirectory();
  yield* writeTextFile(joinPath(bin, "podman"), "");
  yield* changeMode(joinPath(bin, "podman"), 0o755);
  return bin;
});

const prefersMsaOtlpEndpointThenTelemetryOtlpendpoint = (bin: string) => {
  expect(
    resolveDestination({
      envEndpoint: "http://env:4318",
      path: bin,
      settingsEndpoint: "http://settings:4318",
      version: "0.0.0",
    }),
  ).toEqual({ endpoint: "http://env:4318", kind: "endpoint", source: "MSA_OTLP_ENDPOINT" });
  expect(
    resolveDestination({
      envEndpoint: " ",
      path: bin,
      settingsEndpoint: "http://settings:4318",
      version: "0.0.0",
    }),
  ).toEqual({
    endpoint: "http://settings:4318",
    kind: "endpoint",
    source: "telemetry.otlpEndpoint",
  });
  expect(
    resolveDestination({
      envEndpoint: undefined,
      path: bin,
      settingsEndpoint: undefined,
      version: "0.0.0",
    }),
  ).toEqual({ kind: "lgtm", podman: joinPath(bin, "podman") });
};

const recordsNothingAndSaysWhyWhenNo = () =>
  runTest(
    Effect.gen(function* () {
      const telemetry = yield* awaited(
        startTelemetry({
          envEndpoint: undefined,
          path: yield* emptyDirectory(),
          settingsEndpoint: undefined,
          version: "0.0.0",
        }),
      );

      expect(telemetry.context).toBe(NOOP_TELEMETRY_CONTEXT);
      expect(describeTelemetry(telemetry.status())).toBe(
        "Telemetry off: podman not found; install podman or set MSA_OTLP_ENDPOINT to send traces, metrics, and logs",
      );
      yield* awaited(telemetry.dispose());
    }),
  );

const sendsSpansMetricsAndLogsToThe = () =>
  runTest(
    Effect.gen(function* () {
      const received = new Map<string, string>();
      const endpoint = yield* listen((request) =>
        Effect.map(readBody(request), (body) => {
          const path = new URL(request.url).pathname;
          received.set(path, (received.get(path) ?? "") + body);
          return Response.json({});
        }),
      );

      const telemetry = yield* awaited(
        startTelemetry({
          envEndpoint: endpoint,
          path: yield* emptyDirectory(),
          settingsEndpoint: undefined,
          version: "9.9.9",
        }),
      );
      yield* awaited(
        telemetry.context.startSpan({ name: "msa.task" }, (span) => {
          span.log({ body: "msa.orchestrator.report", severity: "info" });
        }),
      );
      telemetry.context.recordMetric({ kind: "counter", name: "msa.tool.calls", value: 1 });
      yield* awaited(telemetry.dispose());

      expect(describeTelemetry(telemetry.status())).toBe(
        `Telemetry: OTLP ${endpoint} (MSA_OTLP_ENDPOINT)`,
      );
      expect(received.get("/v1/traces")).toContain('"name":"msa.task"');
      expect(received.get("/v1/logs")).toContain("msa.orchestrator.report");
      expect(received.get("/v1/metrics")).toContain('"name":"msa.tool.calls"');
      expect(received.get("/v1/traces")).toContain('"stringValue":"msa"');
    }),
  );

describe("telemetry destination", () => {
  it("prefers MSA_OTLP_ENDPOINT, then telemetry.otlpEndpoint, then podman on PATH", () =>
    runTest(podmanOnPath()).then(prefersMsaOtlpEndpointThenTelemetryOtlpendpoint));

  it(
    "records nothing and says why when no endpoint is set and podman is missing",
    recordsNothingAndSaysWhyWhenNo,
  );

  it(
    "sends spans, metrics, and logs to the configured endpoint and flushes them on dispose",
    sendsSpansMetricsAndLogsToThe,
  );
});
