import type configTypes from "../config.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import resources from "../resources.ts";
import type runtimeTypes from "../runtime.types.ts";
import type McpExtensionHost from "./host.ts";
import serverState from "./server-state.ts";

const { exposureOf, isEnabled } = serverState;
const { createMcpResourceToolDefinitions } = resources;

export default class McpResourceTools {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly serversWithResources = (): extensionInternalTypes.McpServer[] =>
    this.host.servers.filter(
      (server) =>
        server.connection?.hasResources &&
        isEnabled(server) &&
        exposureOf(server.entry) !== "hidden",
    );

  readonly resourceServers = (): runtimeTypes.McpServerConnection[] =>
    this.serversWithResources().flatMap((server) =>
      server.connection === undefined ? [] : [server.connection],
    );

  resourceToolsExposure: configTypes.McpExposure | undefined;

  readonly syncResourceTools = () => {
    const exposures = new Set(
      this.serversWithResources().map((server) => exposureOf(server.entry)),
    );
    const exposure = (["direct", "codemode", "deferred"] as const).find((candidate) =>
      exposures.has(candidate),
    );
    const next = exposure ?? "hidden";
    if (
      next === this.resourceToolsExposure ||
      (this.resourceToolsExposure === undefined && next === "hidden")
    )
      return;
    const wasDirect = this.resourceToolsExposure === "direct";
    this.resourceToolsExposure = next;
    const resourceDefinitions = createMcpResourceToolDefinitions({
      exposure: next,
      servers: this.resourceServers,
    });
    for (const definition of resourceDefinitions) this.host.msa.registerTool(definition);
    if (wasDirect) {
      const names = new Set(resourceDefinitions.map((definition) => definition.name));
      this.host.msa.setActiveTools(
        this.host.msa.getActiveTools().filter((name) => !names.has(name)),
      );
    }
  };
}
