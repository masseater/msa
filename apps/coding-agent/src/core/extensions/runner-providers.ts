import type { Provider } from "@msa/ai";

import { toErrorMessage } from "../../utils/errors.ts";
import type { ModelRegistry } from "../model-registry.ts";
import type { VirtualModelDefinition } from "../virtual-models.ts";
import type { ExtensionError, ExtensionRuntime, ProviderConfig } from "./types.ts";

export interface ProviderActions {
  registerProvider?: (name: string, config: ProviderConfig) => void;
  registerNativeProvider?: (provider: Provider) => void;
  unregisterProvider?: (name: string) => void;
  registerVirtualModel?: (definition: VirtualModelDefinition) => void;
  unregisterVirtualModel?: (provider: string, id: string) => void;
}

export class ProviderBinder {
  private readonly runtime: ExtensionRuntime;
  private readonly modelRegistry: ModelRegistry;
  private readonly actions: ProviderActions | undefined;
  private readonly emitError: (error: ExtensionError) => void;

  constructor(
    runtime: ExtensionRuntime,
    modelRegistry: ModelRegistry,
    actions: ProviderActions | undefined,
    emitError: (error: ExtensionError) => void,
  ) {
    this.runtime = runtime;
    this.modelRegistry = modelRegistry;
    this.actions = actions;
    this.emitError = emitError;
  }

  bind(): void {
    this.flushPending();
    const { runtime } = this;
    runtime.registerProvider = (name, config) => this.registerProvider(name, config);
    runtime.registerNativeProvider = (provider) => this.registerNativeProvider(provider);
    runtime.unregisterProvider = (name) => {
      if (this.actions?.unregisterProvider === undefined)
        this.modelRegistry.unregisterProvider(name);
      else this.actions.unregisterProvider(name);
    };
    runtime.registerVirtualModel = (definition) => this.registerVirtualModel(definition);
    runtime.unregisterVirtualModel = (provider, id) => {
      if (this.actions?.unregisterVirtualModel === undefined) {
        this.modelRegistry.unregisterVirtualModel(provider, id);
      } else {
        this.actions.unregisterVirtualModel(provider, id);
      }
    };
  }

  private registerProvider(name: string, config: ProviderConfig): void {
    if (this.actions?.registerProvider === undefined)
      this.modelRegistry.registerProvider(name, config);
    else this.actions.registerProvider(name, config);
  }

  private registerNativeProvider(provider: Provider): void {
    if (this.actions?.registerNativeProvider === undefined) {
      this.modelRegistry.registerProvider(provider);
    } else {
      this.actions.registerNativeProvider(provider);
    }
  }

  private registerVirtualModel(definition: VirtualModelDefinition): void {
    if (this.actions?.registerVirtualModel === undefined) {
      this.modelRegistry.registerVirtualModel(definition);
    } else {
      this.actions.registerVirtualModel(definition);
    }
  }

  private flushPending(): void {
    const { runtime } = this;
    for (const { name, config, extensionPath } of runtime.pendingProviderRegistrations) {
      this.guard(extensionPath, "register_provider", () => this.registerProvider(name, config));
    }
    runtime.pendingProviderRegistrations = [];
    for (const { provider, extensionPath } of runtime.pendingNativeProviderRegistrations) {
      this.guard(extensionPath, "register_provider", () => this.registerNativeProvider(provider));
    }
    runtime.pendingNativeProviderRegistrations = [];
    for (const { definition, extensionPath } of runtime.pendingVirtualModelRegistrations) {
      this.guard(extensionPath, "register_virtual_model", () =>
        this.registerVirtualModel(definition),
      );
    }
    runtime.pendingVirtualModelRegistrations = [];
  }

  private guard(extensionPath: string, event: string, register: () => void): void {
    try {
      register();
    } catch (err) {
      this.emitError({
        extensionPath,
        event,
        error: toErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }
}
