import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NOOP_TELEMETRY_CONTEXT } from "@msa/telemetry";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  describeTelemetry,
  resolveDestination,
  startTelemetry,
} from "../src/core/observability/telemetry.ts";

const directories: string[] = [];

function emptyDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "msa-telemetry-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("telemetry destination", () => {
  it("prefers MSA_OTLP_ENDPOINT, then telemetry.otlpEndpoint, then podman on PATH", () => {
    const bin = emptyDirectory();
    writeFileSync(join(bin, "podman"), "");
    chmodSync(join(bin, "podman"), 0o755);

    expect(
      resolveDestination({
        envEndpoint: "http://env:4318",
        settingsEndpoint: "http://settings:4318",
        path: bin,
        version: "0.0.0",
      }),
    ).toEqual({ kind: "endpoint", endpoint: "http://env:4318", source: "MSA_OTLP_ENDPOINT" });
    expect(
      resolveDestination({
        envEndpoint: " ",
        settingsEndpoint: "http://settings:4318",
        path: bin,
        version: "0.0.0",
      }),
    ).toEqual({
      kind: "endpoint",
      endpoint: "http://settings:4318",
      source: "telemetry.otlpEndpoint",
    });
    expect(
      resolveDestination({
        envEndpoint: undefined,
        settingsEndpoint: undefined,
        path: bin,
        version: "0.0.0",
      }),
    ).toEqual({ kind: "lgtm", podman: join(bin, "podman") });
  });

  it("records nothing and says why when no endpoint is set and podman is missing", async () => {
    const telemetry = await startTelemetry({
      envEndpoint: undefined,
      settingsEndpoint: undefined,
      path: emptyDirectory(),
      version: "0.0.0",
    });

    expect(telemetry.context).toBe(NOOP_TELEMETRY_CONTEXT);
    expect(describeTelemetry(telemetry.status())).toBe(
      "Telemetry off: podman not found; install podman or set MSA_OTLP_ENDPOINT to send traces, metrics, and logs",
    );
    await telemetry.dispose();
  });

  it("sends spans, metrics, and logs to the configured endpoint and flushes them on dispose", async () => {
    const received = new Map<string, string>();
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        received.set(request.url ?? "", (received.get(request.url ?? "") ?? "") + body);
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const telemetry = await startTelemetry({
      envEndpoint: endpoint,
      settingsEndpoint: undefined,
      path: emptyDirectory(),
      version: "9.9.9",
    });
    await telemetry.context.startSpan({ name: "msa.task" }, (span) => {
      span.log({ severity: "info", body: "msa.orchestrator.report" });
    });
    telemetry.context.recordMetric({ kind: "counter", name: "msa.tool.calls", value: 1 });
    await telemetry.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(describeTelemetry(telemetry.status())).toBe(
      `Telemetry: OTLP ${endpoint} (MSA_OTLP_ENDPOINT)`,
    );
    expect(received.get("/v1/traces")).toContain('"name":"msa.task"');
    expect(received.get("/v1/logs")).toContain("msa.orchestrator.report");
    expect(received.get("/v1/metrics")).toContain('"name":"msa.tool.calls"');
    expect(received.get("/v1/traces")).toContain('"stringValue":"msa"');
  });
});
