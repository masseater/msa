import type { Provider } from "@msa/ai";

import { type McpServerConfig, mcpNamespace, validateMcpServerConfig } from "../mcp-servers.ts";
import type { ModelRouteRequest, VirtualModelDefinition } from "../virtual-models.ts";
import type { ApiScope } from "./loader-scope.ts";
import type { ExtensionVirtualModel, ProviderConfig } from "./types.ts";

export const providerMembers = ({
  extension,
  runtime,
  assertActive,
  applyRuntimeChange,
}: ApiScope) => ({
  registerProvider(providerOrName: Provider | string, config?: ProviderConfig) {
    assertActive();
    if (typeof providerOrName === "string") {
      if (config === undefined)
        throw new Error("Provider config is required when registering by name");
      applyRuntimeChange(() => runtime.registerProvider(providerOrName, config, extension.path));
      return;
    }
    applyRuntimeChange(() => runtime.registerNativeProvider(providerOrName, extension.path));
  },

  unregisterProvider(name: string) {
    assertActive();
    applyRuntimeChange(() => runtime.unregisterProvider(name, extension.path));
  },

  registerVirtualModel<TState>(model: ExtensionVirtualModel<TState>) {
    assertActive();
    const definition: VirtualModelDefinition = {
      ...model,
      route: (request) =>
        model.route(request as ModelRouteRequest<TState>, runtime.createContext()),
    };
    applyRuntimeChange(() => runtime.registerVirtualModel(definition, extension.path));
  },

  unregisterVirtualModel(provider: string, id: string) {
    assertActive();
    applyRuntimeChange(() => runtime.unregisterVirtualModel(provider, id));
  },
});

export const mcpMembers = ({ extension, runtime, assertActive, applyRuntimeChange }: ApiScope) => ({
  registerMcpServer(name: string, config: McpServerConfig) {
    assertActive();
    const validated = validateMcpServerConfig(name, config);
    if (typeof validated === "string") {
      throw new Error(
        `Invalid MCP server registered by extension "${extension.path}": ${validated}`,
      );
    }
    const owner = runtime.mcpServers.get(name)?.extensionPath;
    if (owner !== undefined && owner !== extension.path) {
      throw new Error(`MCP server "${name}" is already registered by extension "${owner}"`);
    }
    const clash = runtime.mcpServers
      .list()
      .find((server) => server.name !== name && mcpNamespace(server.name) === mcpNamespace(name));
    if (clash !== undefined) {
      throw new Error(`MCP server "${name}" conflicts with registered server "${clash.name}"`);
    }
    const server = { name, config: structuredClone(validated), extensionPath: extension.path };
    applyRuntimeChange(() => runtime.mcpServers.register(server));
  },

  unregisterMcpServer(name: string) {
    assertActive();
    applyRuntimeChange(() => runtime.mcpServers.unregister(name, extension.path));
  },

  getMcpServers() {
    assertActive();
    return runtime.mcpServers.list();
  },
});
