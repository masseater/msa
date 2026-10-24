import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import mcpServers from "../mcp-servers.ts";
import mergeGuard from "../orchestrator/merge-guard.ts";
import settingsManagerSupport from "../settings-manager-support.ts";

const { createToolNameMatcher, isMcpToolName } = mcpServers;
const { DEFAULT_TOOL_NAMES, applyToolModifiers } = settingsManagerSupport;

export default class SessionToolPolicy {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  usesDefaultTools = false;

  defaultToolModifiers: string[] = [];

  allowedTools?: (name: string) => boolean;

  private allowlistFiltersMcp = false;

  private excludedTools?: ((name: string) => boolean) | undefined;

  private isWorker = false;

  applyToolPolicy(config: agentSessionTypes.AgentSessionConfig): void {
    this.isWorker = config.isWorker === true;
    this.usesDefaultTools = config.usesDefaultTools ?? false;
    this.defaultToolModifiers = config.defaultToolModifiers ?? [];
    if (config.allowedToolNames !== undefined) {
      this.allowedTools = createToolNameMatcher(config.allowedToolNames);
      this.allowlistFiltersMcp =
        config.allowedToolNames.length === 0 ||
        config.allowedToolNames.some((entry) => entry.startsWith("mcp__"));
    }
    this.excludedTools =
      config.excludedToolNames === undefined
        ? undefined
        : createToolNameMatcher(config.excludedToolNames);
  }

  get worker(): boolean {
    return this.isWorker;
  }

  refusal(name: string, args: unknown): string | undefined {
    return this.isWorker ? mergeGuard.refusal(name, args) : undefined;
  }

  isAllowedTool(name: string): boolean {
    if (this.excludedTools?.(name) === true) return false;
    if (this.allowedTools === undefined || this.allowedTools(name)) return true;
    return !this.allowlistFiltersMcp && isMcpToolName(name);
  }

  isActivatable(name: string): boolean {
    if (this.allowedTools === undefined || this.allowedTools(name) || !isMcpToolName(name))
      return true;
    return (
      this.session.tools.registry.getToolExposure(name) !== "direct" &&
      this.session.tools.registry.toolRegistry.has("tool_search")
    );
  }

  currentDefaultTools(): string[] {
    if (!this.usesDefaultTools) return [];
    return applyToolModifiers(
      this.session.settingsManager.resources.getDefaultTools() ?? DEFAULT_TOOL_NAMES,
      this.defaultToolModifiers,
    );
  }
}
