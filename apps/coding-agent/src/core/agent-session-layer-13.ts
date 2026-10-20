import type agentTypes from "@msa/agent-core/index.types";

import errors from "../utils/errors.ts";
import frontmatter from "../utils/frontmatter.ts";
import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer12 from "./agent-session-layer-12.ts";
import type bashExecutorTypes from "./bash-executor.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type messagesTypes from "./messages.types.ts";
import platform from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";

const { nowMs } = platform;
const { toErrorMessage } = errors;
const { readFileSync } = nodeFs;
const { stripFrontmatter } = frontmatter;

export default abstract class AgentSessionLayer13 extends AgentSessionLayer12 {
  protected forwardedExtensionEvent(
    event: agentTypes.AgentEvent,
  ): Parameters<extensionsTypes.ExtensionRunner["emit"]>[0] | undefined {
    switch (event.type) {
      case "agent_end":
        return { messages: event.messages, type: "agent_end" };
      case "turn_start":
        return { timestamp: nowMs(), turnIndex: this.turnIndex, type: "turn_start" };
      case "message_start":
        return { message: event.message, type: "message_start" };
      case "message_update":
        return {
          assistantMessageEvent: event.assistantMessageEvent,
          message: event.message,
          type: "message_update",
        };
      case "tool_execution_start":
        return {
          args: event.args,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool_execution_start",
        };
      case "tool_execution_update":
        return {
          args: event.args,
          partialResult: event.partialResult,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool_execution_update",
        };
      case "tool_execution_end":
        return {
          isError: event.isError,
          result: event.result,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool_execution_end",
          ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        };
      default:
        return undefined;
    }
  }

  setActiveToolsByName(toolNames: string[]): void {
    const previous = this.getActiveToolNames();
    this.setActiveTools(toolNames);
    const active = new Set(this.getActiveToolNames());
    if (previous.some((name) => !active.has(name))) this.pendingToolNames.clear();
  }

  protected setActiveTools(toolNames: string[]): void {
    const tools = this.applyToolLoadout(toolNames);
    for (const tool of tools) this.pendingToolNames.delete(tool.name);
    this.rebuildSystemPrompt(tools.map((tool) => tool.name));
  }

  protected runLoadoutHooks(
    tools: agentTypes.AgentTool[],
    hooks: agentSessionInternalTypes.ToolDefinitionEntry[],
  ) {
    const loadout: extensionsTypes.ToolLoadout = {
      callable: this.getCallableTools(new Set(tools.map((tool) => tool.name))),
      declared: tools,
      getExposure: (name) => this.getToolExposure(name),
      getNamespace: (name) => this.toolDefinitions.get(name)?.definition.namespace,
      getPromptGuidelines: (name) => this.toolPromptGuidelines.get(name) ?? [],
      registered: [...this.toolRegistry.values()],
    };
    const descriptions = new Map<string, string>();
    const hidden = new Set<string>();
    for (const { definition, sourceInfo } of hooks) {
      try {
        const changes = definition.prepareLoadout?.(loadout);
        for (const [name, description] of Object.entries(changes?.descriptions ?? {}))
          descriptions.set(name, description);
        for (const name of changes?.hiddenDeclarations ?? []) hidden.add(name);
      } catch (error) {
        this.extensionRunnerInternal.emitError({
          error: toErrorMessage(error),
          event: "prepare_loadout",
          extensionPath: sourceInfo.path,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
    const declared = tools.map((tool) => {
      const description = descriptions.get(tool.name);
      return description === undefined ? tool : Object.assign({}, tool, { description });
    });
    return { declared, hidden };
  }

  protected applyToolLoadout(toolNames: string[]): agentTypes.AgentTool[] {
    if (this.askRun) this.loadoutBeforeAsk = [...new Set(toolNames)];
    const tools = [...new Set(toolNames)].flatMap((name) => {
      const tool = this.toolRegistry.get(name);
      if (
        tool === undefined ||
        this.getToolExposure(name) === "hidden" ||
        !this.isActivatable(name)
      )
        return [];
      return this.askRun ? this.askTool(name, tool) : [tool];
    });
    const hooks = tools.flatMap((tool) => {
      const entry = this.toolDefinitions.get(tool.name);
      return entry?.definition.prepareLoadout === undefined ? [] : [entry];
    });
    const { declared, hidden } =
      hooks.length > 0
        ? this.runLoadoutHooks(tools, hooks)
        : { declared: tools, hidden: new Set<string>() };
    this.hiddenDeclarations = hidden;
    this.agent.state.tools = declared;
    return declared;
  }

  protected endAskRun(): void {
    if (!this.askRun) return;
    this.askRun = false;
    this.setActiveTools(this.loadoutBeforeAsk);
    this.loadoutBeforeAsk = [];
  }

  protected expandSkillCommand(text: string): string {
    if (!text.startsWith("/")) return text;

    const spaceIndex = text.indexOf(" ");
    const skillName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

    const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
    if (skill === undefined) return text;

    try {
      const content = readFileSync(skill.filePath, "utf-8");
      const body = stripFrontmatter(content).trim();
      const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
      return args === "" ? skillBlock : `${skillBlock}\n\n${args}`;
    } catch (err) {
      this.extensionRunnerInternal.emitError({
        error: toErrorMessage(err),
        event: "skill_expansion",
        extensionPath: skill.filePath,
      });
      return text;
    }
  }

  protected refreshToolRegistry(options?: {
    activeToolNames?: string[];
    includeAllExtensionTools?: boolean | undefined;
  }): void {
    const previousActivatedOnRegistration = new Set(
      [...this.toolRegistry.keys()].filter((name) => this.isActivatedOnRegistration(name)),
    );
    const previousActiveToolNames = this.getActiveToolNames();
    const { allCustomTools, definitionRegistry } = this.collectToolDefinitions();
    this.toolDefinitions = definitionRegistry;
    this.indexToolPrompts(definitionRegistry);
    const wrappedExtensionTools = this.wrapToolRegistry(allCustomTools, definitionRegistry);
    const nextActiveToolNames = [
      ...(options?.activeToolNames ?? previousActiveToolNames).filter((name) =>
        this.isAllowedTool(name),
      ),
      ...this.registrationActivations(
        options,
        previousActivatedOnRegistration,
        wrappedExtensionTools,
      ),
      ...this.pendingToolNames,
    ];
    this.setActiveTools([...new Set(nextActiveToolNames)]);
  }

  recordBashResult(
    command: string,
    result: bashExecutorTypes.BashResult,
    options?: { excludeFromContext?: boolean | undefined },
  ): void {
    const bashMessage: messagesTypes.BashExecutionMessage = {
      cancelled: result.cancelled,
      command,
      excludeFromContext: options?.excludeFromContext,
      exitCode: result.exitCode,
      fullOutputPath: result.fullOutputPath,
      output: result.output,
      role: "bashExecution",
      timestamp: nowMs(),
      truncated: result.truncated,
    };

    if (this.isStreaming) {
      this.pendingBashMessages.push(bashMessage);
    } else {
      this.sessionManager.appendMessage(bashMessage);
      this.refreshFinalizedContext();
    }
  }
}
