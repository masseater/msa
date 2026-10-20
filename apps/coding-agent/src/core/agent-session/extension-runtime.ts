import compat from "@msa/ai/compat";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import runnerEvents from "../extensions/runner-events.ts";
import settingsManagerSupport from "../settings-manager-support.ts";

const { resetApiProviders } = compat;
const { awaited, awaitingWith, performed } = awaitingModule;
const { DEFAULT_TOOL_NAMES } = settingsManagerSupport;
const { emitSessionShutdownEvent } = runnerEvents;

export default class SessionExtensionRuntime {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  buildRuntime(options: {
    activeToolNames?: string[] | undefined;
    flagValues?: Map<string, boolean | string>;
    includeAllExtensionTools?: boolean;
  }): void {
    this.session.integrations.memory.resetMemory();
    this.session.tools.registry.resetBaseToolDefinitions();
    this.session.extensions.binding.createExtensionRunner(options.flagValues);
    this.session.extensions.actions.bindExtensionCore(
      this.session.extensions.binding.extensionRunnerInternal,
    );
    this.session.extensions.binding.applyExtensionBindings(
      this.session.extensions.binding.extensionRunnerInternal,
    );
    if (this.session.tools.registry.baseToolsOverride === undefined)
      this.session.tools.externalServices.addExternalServiceTools();
    const defaultActiveToolNames =
      this.session.tools.registry.baseToolsOverride === undefined
        ? [...DEFAULT_TOOL_NAMES]
        : Object.keys(this.session.tools.registry.baseToolsOverride);
    this.session.tools.registry.refreshToolRegistry({
      activeToolNames: options.activeToolNames ?? defaultActiveToolNames,
      includeAllExtensionTools: options.includeAllExtensionTools,
    });
  }

  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { loadout } = this.session.tools;
        const oldRunner = this.session.extensions.binding.extensionRunnerInternal;
        const previousFlagValues = oldRunner.getFlagValues();
        yield* awaited(
          emitSessionShutdownEvent(oldRunner, { reason: "reload", type: "session_shutdown" }),
        );
        oldRunner.invalidate();
        const previousDefaultTools = new Set(this.session.tools.policy.currentDefaultTools());
        yield* awaited(this.session.settingsManager.reload());
        this.session.run.queue.syncQueueModesFromSettings();
        resetApiProviders();
        yield* awaited(this.session.resourceLoader.reload());
        const addedDefaultTools = this.session.tools.policy
          .currentDefaultTools()
          .filter((name) => !previousDefaultTools.has(name));
        for (const name of loadout.getActiveToolNames()) loadout.pendingToolNames.add(name);
        this.buildRuntime({
          activeToolNames: [...loadout.getActiveToolNames(), ...addedDefaultTools],
          flagValues: previousFlagValues,
          includeAllExtensionTools: true,
        });
        yield* performed(this.restartBoundExtensions(options));
      }, this),
    );
  }

  private restartBoundExtensions(options?: {
    beforeSessionStart?: () => void | Promise<void>;
  }): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { binding } = this.session.extensions;
      const hasBindings =
        binding.extensionUIContext ||
        binding.extensionCommandContextActions ||
        binding.extensionShutdownHandler ||
        binding.extensionErrorListener;
      if (hasBindings === undefined) return;
      yield* awaited(options?.beforeSessionStart?.());
      yield* awaited(
        binding.extensionRunnerInternal.emit({ reason: "reload", type: "session_start" }),
      );
      binding.extensionRunnerInternal.reportUnhandledMcpServers();
      yield* performed(this.session.extensions.resources.extendResourcesFromExtensions("reload"));
    }, this);
  }

  start(): void {
    const { loadout, policy } = this.session.tools;
    this.buildRuntime({
      activeToolNames: loadout.initialActiveToolNames,
      includeAllExtensionTools: true,
    });
    if (policy.usesDefaultTools) loadout.restoreToolsFromTranscript(policy.defaultToolModifiers);
  }
}
