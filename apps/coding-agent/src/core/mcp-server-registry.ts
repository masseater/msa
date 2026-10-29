import mcpServersModule from "./mcp-servers.ts";
import type mcpServersTypes from "./mcp-servers.types.ts";
import memoryModule from "./memory/memory.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { ignoredMcpServerNotice, isSepiaceServer, sepiaceUrl } = memoryModule;
const { mcpNamespace, validateMcpServerConfig } = mcpServersModule;

export default class McpServerRegistry {
  private readonly globalSettings: () => settingsManagerTypes.Settings;
  private readonly servers = new Map<string, mcpServersTypes.RegisteredMcpServer>();
  private readonly ignoredNotices: string[] = [];
  private changeListener: (() => void) | undefined;
  private ignoreListener: ((notice: string, extensionPath: string) => void) | undefined;

  constructor(globalSettings: () => settingsManagerTypes.Settings) {
    this.globalSettings = globalSettings;
  }

  admit(input: {
    name: string;
    config: unknown;
    extensionPath: string;
  }): mcpServersTypes.McpServerAdmission {
    const { name, extensionPath } = input;
    if (isSepiaceServer(name, input.config, sepiaceUrl(this.globalSettings())))
      return { extensionPath, ignored: true, name };
    const config = validateMcpServerConfig(name, input.config);
    if (typeof config === "string") {
      throw new Error(`Invalid MCP server registered by extension "${extensionPath}": ${config}`);
    }
    const owner = this.servers.get(name)?.extensionPath;
    if (owner !== undefined && owner !== extensionPath) {
      throw new Error(`MCP server "${name}" is already registered by extension "${owner}"`);
    }
    const clash = [...this.servers.values()].find(
      (server) => server.name !== name && mcpNamespace(server.name) === mcpNamespace(name),
    );
    if (clash !== undefined) {
      throw new Error(`MCP server "${name}" conflicts with registered server "${clash.name}"`);
    }
    return { config: structuredClone(config), extensionPath, ignored: false, name };
  }

  register(admission: mcpServersTypes.McpServerAdmission): void {
    if (admission.ignored) {
      this.ignore(admission.name, admission.extensionPath);
      return;
    }
    const { config, extensionPath, name } = admission;
    this.servers.set(name, { config, extensionPath, name });
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

  private ignore(name: string, extensionPath: string): void {
    this.unregister(name, extensionPath);
    const notice = ignoredMcpServerNotice(extensionPath, name);
    if (this.ignoreListener !== undefined) this.ignoreListener(notice, extensionPath);
    else if (!this.ignoredNotices.includes(notice)) this.ignoredNotices.push(notice);
  }
}
