import * as Effect from "effect/Effect";

import errors from "../utils/errors.ts";
import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer7 from "./agent-session-layer-7.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import externalServices from "./external-services.ts";
import type externalServicesTypes from "./external-services.types.ts";
import platformNode from "./platform-node.ts";
import sourceInfoModule from "./source-info.ts";

const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errors;
const { BUILTIN_PATH_PREFIX, createSyntheticSourceInfo, isSyntheticPath } = sourceInfoModule;
const { basename, dirname } = platformNode;
const { EXTERNAL_SERVICES } = externalServices;

export default abstract class AgentSessionLayer8 extends AgentSessionLayer7 {
  protected emitSessionCompactFailed(
    event: Omit<extensionsTypes.SessionCompactFailedEvent, "type">,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (this.extensionRunnerInternal.hasHandlers("session_compact_failed")) {
        yield* awaited(
          this.extensionRunnerInternal.emit({ type: "session_compact_failed", ...event }),
        );
      }
    }, this);
  }

  protected emitAgentSettled(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.cacheWarmer?.onAgentSettled();
      this.isAgentRunActive = false;
      this.isEmittingAgentSettled = true;
      try {
        const aborted = this.agentRunAbortRequested;
        yield* awaited(this.extensionRunnerInternal.emit({ aborted, type: "agent_settled" }));
        this.emit({ aborted, type: "agent_settled" });
      } finally {
        this.isEmittingAgentSettled = false;
      }

      const deferred = this.deferredSettledActions.splice(0);
      if (deferred.length > 0) {
        try {
          for (const action of deferred) yield* awaited(action());
        } finally {
          this.resolveIdleWaitIfIdle();
        }
        return;
      }
      this.resolveIdleWaitIfIdle();
    }, this);
  }

  protected tryExecuteExtensionCommand(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const spaceIndex = text.indexOf(" ");
      const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
      const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

      const command = this.extensionRunnerInternal.getCommand(commandName);
      if (command === undefined || this.isSkillCommand(text)) return false;

      const ctx = this.extensionRunnerInternal.createCommandContext();

      try {
        yield* awaited(command.handler(args, ctx));
        return true;
      } catch (err) {
        this.extensionRunnerInternal.emitError({
          error: toErrorMessage(err),
          event: "command",
          extensionPath: `command:${commandName}`,
        });
        return true;
      }
    }, this);
  }

  abort(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isAgentRunActive) {
          this.agentRunAbortRequested = true;
        }
        this.abortRetry();
        this.abortCompaction();
        this.abortBranchSummary();
        this.goalInternal.abort();
        if (this.isBeforeSettle) this.abortDuringBeforeSettle = true;
        this.agent.abort();
        yield* awaited(this.waitForIdle());
      }, this),
    );
  }

  waitForIdle(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isIdle) {
          return;
        }
        yield* awaited(this.getIdleWaitPromise());
      }, this),
    );
  }

  protected requestExtensionCompaction(run: agentSessionInternalTypes.CompactionRun) {
    return awaitingWith(function* () {
      if (!this.extensionRunnerInternal.hasHandlers("session_before_compact")) return undefined;
      const result = (yield* awaited(
        this.extensionRunnerInternal.emit({
          branchEntries: run.pathEntries,
          customInstructions: run.customInstructions,
          preparation: run.preparation,
          reason: run.reason,
          signal: run.signal,
          type: "session_before_compact",
          willRetry: run.willRetry,
        }),
      )) as extensionsTypes.SessionBeforeCompactResult | undefined;
      if (result?.cancel === true) {
        run.outcome.cancelledByExtension = true;
        throw new Error("Compaction cancelled");
      }
      if (result?.compaction === undefined) return undefined;
      run.outcome.fromExtension = true;
      return result.compaction;
    }, this);
  }

  protected buildExtensionResourcePaths(
    entries: Array<{ path: string; extensionPath: string }>,
  ): Array<{
    path: string;
    metadata: { source: string; scope: "temporary"; origin: "top-level"; baseDir?: string };
  }> {
    return entries.map((entry) => {
      const source = this.getExtensionSourceLabel(entry.extensionPath);
      const baseDir = isSyntheticPath(entry.extensionPath)
        ? undefined
        : dirname(entry.extensionPath);
      return {
        metadata: {
          origin: "top-level",
          scope: "temporary",
          source,
          ...(baseDir === undefined ? {} : { baseDir }),
        },
        path: entry.path,
      };
    });
  }

  protected getExtensionSourceLabel(extensionPath: string): string {
    if (isSyntheticPath(extensionPath)) {
      return `extension:${extensionPath.replace(/[<>]/gu, "")}`;
    }
    const base = basename(extensionPath);
    const name = base.replace(/\.(ts|js)$/u, "");
    return `extension:${name}`;
  }

  protected reportRuntimeError(runner: extensionsTypes.ExtensionRunner, event: string) {
    return (err: unknown) =>
      runner.emitError({ error: toErrorMessage(err), event, extensionPath: "<runtime>" });
  }

  protected builtinToolEntry(name: string, definition: extensionsTypes.ToolDefinition) {
    return {
      definition,
      sourceInfo: createSyntheticSourceInfo(`${BUILTIN_PATH_PREFIX}${name}`, { source: "builtin" }),
    };
  }

  protected collectToolDefinitions() {
    const allCustomTools = [
      ...this.extensionRunnerInternal.getAllRegisteredTools(),
      ...this.customTools.map((definition) => ({
        definition,
        sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
      })),
    ].filter((tool) => this.isAllowedTool(tool.definition.name));
    const definitionRegistry = new Map<string, agentSessionInternalTypes.ToolDefinitionEntry>(
      Array.from(this.baseToolDefinitions.entries())
        .filter(([name]) => this.isAllowedTool(name))
        .map(([name, definition]) => [name, this.builtinToolEntry(name, definition)]),
    );
    for (const tool of allCustomTools) {
      definitionRegistry.set(tool.definition.name, {
        definition: tool.definition,
        sourceInfo: tool.sourceInfo,
      });
    }
    return { allCustomTools, definitionRegistry };
  }

  getExternalServices(): externalServicesTypes.ExternalService[] {
    return [...EXTERNAL_SERVICES, ...this.extensionRunnerInternal.getExternalServices()];
  }

  protected addExternalServiceTools(): string[] {
    const names: string[] = [];
    for (const service of this.getExternalServices()) {
      for (const tool of service.tools?.() ?? []) {
        this.baseToolDefinitions.set(tool.name, tool);
        names.push(tool.name);
      }
    }
    return names;
  }

  protected treeExtensionOverrides(
    preparation: extensionsTypes.TreePreparation,
    signal: AbortSignal,
    summarize: boolean,
  ) {
    return awaitingWith(function* () {
      const instructions: agentSessionInternalTypes.TreeInstructions = {
        customInstructions: preparation.customInstructions,
        label: preparation.label,
        replaceInstructions: preparation.replaceInstructions,
      };
      if (!this.extensionRunnerInternal.hasHandlers("session_before_tree"))
        return { cancelled: false, extensionSummary: undefined, instructions };
      const result = (yield* awaited(
        this.extensionRunnerInternal.emit({ preparation, signal, type: "session_before_tree" }),
      )) as extensionsTypes.SessionBeforeTreeResult | undefined;
      if (result?.cancel === true)
        return { cancelled: true, extensionSummary: undefined, instructions };
      if (result?.customInstructions !== undefined)
        instructions.customInstructions = result.customInstructions;
      if (result?.replaceInstructions !== undefined)
        instructions.replaceInstructions = result.replaceInstructions;
      if (result?.label !== undefined) instructions.label = result.label;
      const extensionSummary = summarize ? result?.summary : undefined;
      return { cancelled: false, extensionSummary, instructions };
    }, this);
  }
}
