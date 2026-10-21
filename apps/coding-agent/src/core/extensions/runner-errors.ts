import type runnerTypesTypes from "./runner-types.ts";
import type extensionsTypesTypes from "./types.types.ts";

export default class RunnerErrors {
  private readonly listeners = new Set<runnerTypesTypes.ExtensionErrorListener>();
  private readonly reportedMcpServers = new Set<string>();

  onError(listener: runnerTypesTypes.ExtensionErrorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(error: extensionsTypesTypes.ExtensionError): void {
    for (const listener of this.listeners) {
      listener(error);
    }
  }

  reportUnhandledMcpServers(servers: readonly { name: string; extensionPath: string }[]): void {
    for (const server of servers) {
      if (this.reportedMcpServers.has(server.name)) continue;
      this.reportedMcpServers.add(server.name);
      this.emit({
        error: `MCP server "${server.name}" is registered, but no loaded extension connects MCP servers; another extension may have replaced the built-in MCP support`,
        event: "register_mcp_server",
        extensionPath: server.extensionPath,
      });
    }
  }
}
