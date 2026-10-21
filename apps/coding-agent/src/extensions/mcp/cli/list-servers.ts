import * as Effect from "effect/Effect";

import configModule from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import platform from "../../../core/platform/index.ts";
import type cliInternalTypes from "../cli-internal.types.ts";
import type cliTypes from "../cli.types.ts";
import mcpConfig from "../config.ts";
import type configTypes from "../config.types.ts";
import type runtimeTypes from "../runtime.types.ts";
import serverConnection from "./server-connection.ts";

const { APP_NAME } = configModule;
const { awaited, awaiting } = awaitingModule;
const { join } = platform;
const { getMcpToolExposure } = mcpConfig;
const { createConnection, describeTransport } = serverConnection;

type Report = cliInternalTypes.ServerReport;
type Line = (line: string) => void;

function reportServer(
  entry: configTypes.McpServerEntry,
  options: cliTypes.McpCommandOptions,
  credentials: runtimeTypes.McpOAuthCredentialStore,
): Promise<Report> {
  return Effect.runPromise(
    awaiting(function* () {
      const report: Report = {
        enabled: entry.config.enabled !== false,
        exposure: entry.config.exposure ?? "codemode",
        name: entry.name,
        scope: entry.scope ?? "global",
        source: entry.source,
        state: "disabled",
        tools: [],
        transport: describeTransport(entry),
        ...(entry.override !== undefined && entry.override !== ""
          ? { override: entry.override }
          : {}),
      };
      if (!report.enabled) return report;
      const connection = createConnection(entry, options, credentials);
      try {
        yield* awaited(connection.getClient());
      } catch {}
      report.state = connection.state;
      report.tools = connection.tools.map((tool) => tool.name);
      const overrides = connection.tools.flatMap((tool) => {
        const exposure = getMcpToolExposure(entry.config, tool.name);
        return exposure === report.exposure ? [] : [[tool.name, exposure] as const];
      });
      if (overrides.length > 0) report.toolExposure = Object.fromEntries(overrides);
      if (connection.hasResources) report.resources = true;
      if (
        connection.state !== "connected" &&
        connection.error !== undefined &&
        connection.error !== ""
      )
        report.error = connection.error;
      yield* awaited(connection.close());
      return report;
    }),
  );
}

function describeState(report: Report): string {
  if (report.state === "connected") {
    return `connected, ${report.tools.length} tool${report.tools.length === 1 ? "" : "s"}`;
  }
  return report.state === "needs-auth" ? "needs sign-in" : report.state;
}

function printReport(report: Report, log: Line): void {
  log(`${report.name}: ${describeState(report)} (${report.exposure}, ${report.scope})`);
  log(`  ${report.transport}`);
  if (report.override !== undefined && report.override !== "")
    log(`  project override: ${report.override}`);
  if (report.state === "needs-auth") log(`  sign in with: ${APP_NAME} mcp login ${report.name}`);
  if (report.tools.length > 0) {
    const tools = report.tools.map((tool) => {
      const exposure = report.toolExposure?.[tool];
      return exposure !== undefined && exposure !== "" ? `${tool} [${exposure}]` : tool;
    });
    log(`  tools: ${tools.join(", ")}`);
  }
  if (report.resources !== undefined) log("  offers resources");
  if (report.error !== undefined && report.error !== "")
    log(`  ${report.error.split("\n").join("\n  ")}`);
}

function printReports(
  reports: readonly Report[],
  loaded: configTypes.LoadedMcpConfig,
  untrustedNote: string | undefined,
  options: cliTypes.McpCommandOptions,
  log: Line,
): void {
  if (reports.length === 0 && loaded.errors.length === 0) {
    log(
      `No MCP servers configured. Add them to ${join(options.agentDir, "mcp.json")} or .msa/mcp.json.`,
    );
  }
  for (const report of reports) printReport(report, log);
  for (const configError of loaded.errors) log(`config error: ${configError}`);
  if (untrustedNote !== undefined && untrustedNote !== "") log(untrustedNote);
}

function list(
  loaded: configTypes.LoadedMcpConfig,
  json: boolean,
  untrustedNote: string | undefined,
  options: cliTypes.McpCommandOptions,
  credentials: runtimeTypes.McpOAuthCredentialStore,
  log: Line,
): Promise<number> {
  return Effect.runPromise(
    awaiting(function* () {
      const reports = yield* awaited(
        Promise.all(loaded.servers.map((entry) => reportServer(entry, options, credentials))),
      );
      const failed =
        loaded.errors.length > 0 ||
        reports.some((report) => report.enabled && report.state !== "connected");
      if (json) {
        const note =
          untrustedNote !== undefined && untrustedNote !== "" ? { note: untrustedNote } : {};
        log(JSON.stringify({ errors: loaded.errors, servers: reports, ...note }, null, 2));
      } else {
        printReports(reports, loaded, untrustedNote, options, log);
      }
      return failed ? 1 : 0;
    }),
  );
}

const listServers = { list };

export default listServers;
