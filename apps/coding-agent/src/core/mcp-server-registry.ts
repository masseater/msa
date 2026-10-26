import type mcpServersTypes from "./mcp-servers.types.ts";

export default class McpServerRegistry {
  private readonly servers = new Map<string, mcpServersTypes.RegisteredMcpServer>();
  private changeListener: (() => void) | undefined;

  register(server: mcpServersTypes.RegisteredMcpServer): void {
    this.servers.set(server.name, server);
    this.changeListener?.();
  }

  unregister(name: string, extensionPath: string): void {
    if (this.servers.get(name)?.extensionPath !== extensionPath) return;
    this.servers.delete(name);
    this.changeListener?.();
  }

  get(name: string): mcpServersTypes.RegisteredMcpServer | undefined {
    return this.servers.get(name);
  }

  list(): mcpServersTypes.RegisteredMcpServer[] {
    return Array.from(this.servers.values(), (server) => ({
      ...server,
      config: structuredClone(server.config),
    }));
  }

  setChangeListener(listener: (() => void) | undefined): void {
    this.changeListener = listener;
  }
}
