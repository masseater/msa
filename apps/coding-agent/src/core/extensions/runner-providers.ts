import type aiTypes from "@msa/ai/index.types";

import errors from "../../utils/errors.ts";
import type modelRegistryTypes from "../model-registry.types.ts";
import type virtualModelsTypes from "../virtual-models.types.ts";
import type runnerProvidersTypes from "./runner-providers.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { toErrorMessage } = errors;

export default class ProviderBinder {
  private readonly runtime: extensionsTypesTypes.ExtensionRuntime;
  private readonly modelRegistry: modelRegistryTypes.ModelRegistry;
  private readonly actions: runnerProvidersTypes.ProviderActions | undefined;
  private readonly emitError: (error: extensionsTypesTypes.ExtensionError) => void;

  constructor(
    runtime: extensionsTypesTypes.ExtensionRuntime,
    modelRegistry: modelRegistryTypes.ModelRegistry,
    actions: runnerProvidersTypes.ProviderActions | undefined,
    emitError: (error: extensionsTypesTypes.ExtensionError) => void,
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

  private registerProvider(name: string, config: extensionsTypesTypes.ProviderConfig): void {
    if (this.actions?.registerProvider === undefined)
      this.modelRegistry.registerProvider(name, config);
    else this.actions.registerProvider(name, config);
  }

  private registerNativeProvider(provider: aiTypes.Provider): void {
    if (this.actions?.registerNativeProvider === undefined) {
      this.modelRegistry.registerProvider(provider);
    } else {
      this.actions.registerNativeProvider(provider);
    }
  }

  private registerVirtualModel(definition: virtualModelsTypes.VirtualModelDefinition): void {
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
        error: toErrorMessage(err),
        event,
        extensionPath,
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }
}
