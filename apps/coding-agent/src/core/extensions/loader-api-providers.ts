import type aiTypes from "@msa/ai/index.types";

import mcpServersModule from "../mcp-servers.ts";
import type mcpServersTypes from "../mcp-servers.types.ts";
import type virtualModelsTypes from "../virtual-models.types.ts";
import type loaderScopeTypes from "./loader-scope.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { mcpNamespace, validateMcpServerConfig } = mcpServersModule;

const providerMembers = ({
  extension,
  runtime,
  assertActive,
  applyRuntimeChange,
}: loaderScopeTypes.ApiScope) => ({
  registerProvider(
    providerOrName: aiTypes.Provider | string,
    config?: extensionsTypesTypes.ProviderConfig,
  ) {
    assertActive();
    if (typeof providerOrName === "string") {
      if (config === undefined)
        throw new Error("Provider config is required when registering by name");
      applyRuntimeChange(() => runtime.registerProvider(providerOrName, config, extension.path));
      return;
    }
    applyRuntimeChange(() => runtime.registerNativeProvider(providerOrName, extension.path));
  },

  registerVirtualModel<TState>(model: extensionsTypesTypes.ExtensionVirtualModel<TState>) {
    assertActive();
    const definition: virtualModelsTypes.VirtualModelDefinition = {
      ...model,
      route: (request) =>
        model.route(
          request as virtualModelsTypes.ModelRouteRequest<TState>,
          runtime.createContext(),
        ),
    };
    applyRuntimeChange(() => runtime.registerVirtualModel(definition, extension.path));
  },

  unregisterProvider(name: string) {
    assertActive();
    applyRuntimeChange(() => runtime.unregisterProvider(name, extension.path));
  },

  unregisterVirtualModel(provider: string, id: string) {
    assertActive();
    applyRuntimeChange(() => runtime.unregisterVirtualModel(provider, id));
  },
});

const mcpMembers = ({
  extension,
  runtime,
  assertActive,
  applyRuntimeChange,
}: loaderScopeTypes.ApiScope) => ({
  getMcpServers() {
    assertActive();
    return runtime.mcpServers.list();
  },

  registerMcpServer(name: string, config: mcpServersTypes.McpServerConfig) {
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
    const server = { config: structuredClone(validated), extensionPath: extension.path, name };
    applyRuntimeChange(() => runtime.mcpServers.register(server));
  },

  unregisterMcpServer(name: string) {
    assertActive();
    applyRuntimeChange(() => runtime.mcpServers.unregister(name, extension.path));
  },
});

const loaderApiProviders = {
  mcpMembers,
  providerMembers,
};

export default loaderApiProviders;
