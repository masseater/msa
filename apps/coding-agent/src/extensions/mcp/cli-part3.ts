import * as Effect from "effect/Effect";

import configModule from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import platformNode from "../../core/platform-node.ts";
import type cliInternalTypes from "./cli-internal.types.ts";
import cliPart1 from "./cli-part1.ts";
import type cliTypes from "./cli.types.ts";
import mcpConfig from "./config.ts";
import type configTypes from "./config.types.ts";
import type McpOAuthCredentialStore from "./mcp-oauth-credential-store.ts";
import type runtimeTypes from "./runtime.types.ts";

const { awaited, awaiting } = awaitingModule;
const { getMcpToolExposure } = mcpConfig;
const { join } = platformNode;
const { APP_NAME } = configModule;
const { createConnection, describeTransport } = cliPart1;

function list(
  loaded: configTypes.LoadedMcpConfig,
  json: boolean,
  untrustedNote: string | undefined,
  options: cliTypes.McpCommandOptions,
  credentials: runtimeTypes.McpOAuthCredentialStore,
  log: (line: string) => void,
): Promise<number> {
  return Effect.runPromise(
    awaiting(function* () {
      const { reports, failed } = yield* listPart1(loaded, options, credentials);

      if (json) {
        log(
          JSON.stringify(
            {
              errors: loaded.errors,
              servers: reports,
              ...(untrustedNote !== undefined && untrustedNote !== ""
                ? { note: untrustedNote }
                : {}),
            },
            null,
            2,
          ),
        );
        return failed ? 1 : 0;
      }
      if (reports.length === 0 && loaded.errors.length === 0) {
        log(
          `No MCP servers configured. Add them to ${join(options.agentDir, "mcp.json")} or .msa/mcp.json.`,
        );
      }
      for (const report of reports) {
        const state =
          report.state === "connected"
            ? `connected, ${report.tools.length} tool${report.tools.length === 1 ? "" : "s"}`
            : report.state === "needs-auth"
              ? "needs sign-in"
              : report.state;
        log(`${report.name}: ${state} (${report.exposure}, ${report.scope})`);
        log(`  ${report.transport}`);
        if (report.override !== undefined && report.override !== "")
          log(`  project override: ${report.override}`);
        if (report.state === "needs-auth")
          log(`  sign in with: ${APP_NAME} mcp login ${report.name}`);
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
      for (const configError of loaded.errors) log(`config error: ${configError}`);
      if (untrustedNote !== undefined && untrustedNote !== "") log(untrustedNote);
      return failed ? 1 : 0;
    }),
  );
}

const cliPart3 = {
  list,
};

export default cliPart3;

function* listPart1(
  loaded: configTypes.LoadedMcpConfig,
  options: cliTypes.McpCommandOptions,
  credentials: McpOAuthCredentialStore,
) {
  const reports = yield* awaited(
    Promise.all(
      loaded.servers.map((entry): Promise<cliInternalTypes.ServerReport> =>
        Effect.runPromise(
          awaiting(function* () {
            const report: cliInternalTypes.ServerReport = {
              name: entry.name,
              scope: entry.scope ?? "global",
              source: entry.source,
              ...(entry.override !== undefined && entry.override !== ""
                ? { override: entry.override }
                : {}),
              enabled: entry.config.enabled !== false,
              exposure: entry.config.exposure ?? "codemode",
              state: "disabled",
              tools: [],
              transport: describeTransport(entry),
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
        ),
      ),
    ),
  );
  const failed =
    loaded.errors.length > 0 ||
    reports.some((report) => report.enabled && report.state !== "connected");
  return { failed, reports };
}
