import AgentSessionLayer4 from "./agent-session-layer-4.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import goalModule from "./goal.ts";
import type goalTypes from "./goal.types.ts";
import mcpServers from "./mcp-servers.ts";
import platform from "./platform.ts";
import nodeChildProcess from "./platform/node/child-process.ts";
import sessionExport from "./session-export.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import slashCommands from "./slash-commands.ts";

const { createToolNameMatcher, isMcpToolName } = mcpServers;
const { makeLatch } = platform;
const { slashCommandName } = slashCommands;
const { GOAL_ENTRY_TYPE } = goalModule;
const { execFile } = nodeChildProcess;
const { exportSessionToJsonl } = sessionExport;

export default abstract class AgentSessionLayer5 extends AgentSessionLayer4 {
  protected applyToolPolicy(config: agentSessionTypes.AgentSessionConfig): void {
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

  protected emit(event: agentSessionTypes.AgentSessionEvent): void {
    for (const l of this.eventListeners) {
      l(event);
    }
  }

  protected emitQueueUpdate(): void {
    this.emit({
      followUp: [...this.followUpMessages],
      steering: [...this.steeringMessages],
      type: "queue_update",
    });
  }

  protected getIdleWaitPromise(): Promise<void> {
    if (this.idleWaitPromise === undefined) {
      const latch = makeLatch();
      this.resolveIdleWait = latch.open;
      this.idleWaitPromise = latch.promise;
    }
    return this.idleWaitPromise;
  }

  subscribe(listener: agentSessionTypes.AgentSessionEventListener): () => void {
    this.eventListeners.push(listener);

    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  setCacheWarmingMode(mode: settingsManagerTypes.CacheWarmingMode): void {
    this.settingsManager.setCacheWarmingMode(mode);
    this.cacheWarmer?.onModeChanged();
  }

  protected isAllowedTool(name: string): boolean {
    if (this.excludedTools?.(name) === true) return false;
    if (this.allowedTools === undefined || this.allowedTools(name)) return true;
    return !this.allowlistFiltersMcp && isMcpToolName(name);
  }

  protected isActivatable(name: string): boolean {
    if (this.allowedTools === undefined || this.allowedTools(name) || !isMcpToolName(name))
      return true;
    return this.getToolExposure(name) !== "direct" && this.toolRegistry.has("tool_search");
  }

  protected isSkillCommand(text: string): boolean {
    const name = slashCommandName(text);
    return this.resourceLoader.getSkills().skills.some((skill) => skill.name === name);
  }

  protected throwIfExtensionCommand(text: string): void {
    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const command = this.extensionRunnerInternal.getCommand(commandName);

    if (command !== undefined && !this.isSkillCommand(text)) {
      throw new Error(
        `Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
      );
    }
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = [...this.steeringMessages];
    const followUp = [...this.followUpMessages];
    this.steeringMessages = [];
    this.followUpMessages = [];
    this.agent.clearAllQueues();
    this.emitQueueUpdate();
    return { followUp, steering };
  }

  flushQueue(): number {
    const count = this.agent.flushQueuedMessages();
    if (count === 0) return 0;
    this.steeringMessages = [...this.steeringMessages, ...this.followUpMessages];
    this.followUpMessages = [];
    this.emitQueueUpdate();
    return count;
  }

  get goal(): goalTypes.GoalSnapshot | undefined {
    return this.goalInternal.snapshot;
  }

  protected recordGoalEntry(data: goalTypes.GoalEntryData): void {
    const entry = this.sessionManager.getEntry(
      this.sessionManager.appendCustomEntry(GOAL_ENTRY_TYPE, data),
    );
    if (entry !== undefined) this.emit({ entry, type: "entry_appended" });
  }

  protected runCondition(command: string, cwd: string): Promise<boolean> {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    execFile("/bin/sh", ["-c", command], { cwd, timeout: 60_000 }, (error) =>
      resolve(error === null),
    );
    return promise;
  }

  protected finishCancelledRetry(): void {
    if (this.retryAttemptInternal === 0) return;
    const attempt = this.retryAttemptInternal;
    this.retryAttemptInternal = 0;
    this.emit({
      attempt,
      finalError: "Retry cancelled",
      success: false,
      type: "auto_retry_end",
    });
  }

  setSessionName(name: string): void {
    this.sessionManager.appendSessionInfo(name);
    const event = {
      name: this.sessionManager.getSessionName(),
      type: "session_info_changed",
    } as const;
    this.emit(event);
    void this.extensionRunnerInternal.emit(event);
  }

  exportToJsonl(outputPath?: string): string {
    return exportSessionToJsonl(this.sessionManager, outputPath);
  }
}
