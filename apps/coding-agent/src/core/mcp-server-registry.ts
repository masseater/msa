import type mcpServersTypes from "./mcp-servers.types.ts";
import memoryModule from "./memory/memory.ts";

const { ignoredMcpServerNotice, isSepiaceServer } = memoryModule;

export default class McpServerRegistry {
  private readonly servers = new Map<string, mcpServersTypes.RegisteredMcpServer>();
  private readonly ignoredNotices: string[] = [];
  private changeListener: (() => void) | undefined;
  private ignoreListener: ((notice: string, extensionPath: string) => void) | undefined;

  register(server: mcpServersTypes.RegisteredMcpServer): void {
    if (isSepiaceServer(server.name, "url" in server.config ? server.config.url : undefined)) {
      this.ignore(server);
      return;
    }
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

  ignored(): string[] {
    return [...this.ignoredNotices];
  }

  setChangeListener(listener: (() => void) | undefined): void {
    this.changeListener = listener;
  }

  setIgnoreListener(listener: ((notice: string, extensionPath: string) => void) | undefined): void {
    this.ignoreListener = listener;
  }

  private ignore(server: mcpServersTypes.RegisteredMcpServer): void {
    const notice = ignoredMcpServerNotice(server.extensionPath, server.name);
    if (this.ignoreListener !== undefined) this.ignoreListener(notice, server.extensionPath);
    else if (!this.ignoredNotices.includes(notice)) this.ignoredNotices.push(notice);
  }
}
