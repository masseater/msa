import type aiTypes from "@msa/ai/index.types";

import errorsModule from "../../utils/errors.ts";
import cliAgents from "../cli-agents/index.ts";
import type modelConfigTypes from "../model-config.types.ts";
import modelPolicy from "../model-policy.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import providerComposer from "../provider-composer.ts";
import providerModels from "../provider-composer/provider-models.ts";
import virtualModelsModule from "../virtual-models.ts";

const { withVirtualModels } = virtualModelsModule;
const { composeModelProvider } = providerComposer;
const { validateExtensionProvider } = providerModels;
const { EMPTY_MODEL_POLICY, withModelPolicy } = modelPolicy;
const { toErrorMessage } = errorsModule;
const { cliAgentProviders } = cliAgents;

interface VirtualModels {
  providerIds(): Iterable<string>;
  modelsFor(providerId: string): readonly aiTypes.Model<aiTypes.Api>[];
}

export default class ProviderCatalog {
  config: modelConfigTypes.ModelConfig;
  private readonly models: aiTypes.MutableModels;
  private readonly catalogProviders: readonly aiTypes.Provider[];
  private readonly virtualModels: VirtualModels;
  private builtins: ReadonlyMap<string, aiTypes.Provider> = new Map();
  private readonly nativeProviders = new Map<string, aiTypes.Provider>();
  private readonly extensionProviders = new Map<string, modelRuntimeTypes.ProviderConfigInput>();
  private readonly composed = new Map<string, aiTypes.Provider>();
  private readonly compositionErrors = new Map<string, string>();
  private policy: modelRuntimeTypes.ModelPolicy = EMPTY_MODEL_POLICY;

  constructor(
    models: aiTypes.MutableModels,
    catalogProviders: readonly aiTypes.Provider[],
    config: modelConfigTypes.ModelConfig,
    virtualModels: VirtualModels,
  ) {
    this.models = models;
    this.catalogProviders = catalogProviders;
    this.config = config;
    this.virtualModels = virtualModels;
  }

  get modelPolicy(): modelRuntimeTypes.ModelPolicy {
    return this.policy;
  }

  setModelPolicy(policy: modelRuntimeTypes.ModelPolicy): boolean {
    if (
      policy.allow.join("\n") === this.policy.allow.join("\n") &&
      policy.deny.join("\n") === this.policy.deny.join("\n")
    ) {
      return false;
    }
    this.policy = policy;
    this.rebuild();
    return true;
  }

  rebuild(): void {
    this.builtins = new Map(
      [...this.catalogProviders, ...cliAgentProviders()].map((provider) => [provider.id, provider]),
    );
    this.models.clearProviders();
    this.compositionErrors.clear();
    this.composed.clear();
    for (const providerId of this.providerIds()) this.recompose(providerId);
  }

  recompose(providerId: string): aiTypes.Provider | undefined {
    const provider = this.compose(providerId);
    const virtualModels = this.virtualModels.modelsFor(providerId);
    const composed =
      virtualModels.length > 0 ? withVirtualModels(providerId, provider, virtualModels) : provider;
    if (composed === undefined) {
      this.models.deleteProvider(providerId);
      this.composed.delete(providerId);
      return undefined;
    }
    this.composed.set(providerId, composed);
    this.models.setProvider(withModelPolicy(composed, this.policy));
    return provider;
  }

  catalogModels(providerId?: string): readonly aiTypes.Model<aiTypes.Api>[] {
    const providers =
      providerId === undefined
        ? [...this.composed.values()]
        : [this.composed.get(providerId)].filter(
            (provider): provider is aiTypes.Provider => provider !== undefined,
          );
    return providers.flatMap((provider) => provider.getModels());
  }

  compositionError(providerId: string): string | undefined {
    return this.compositionErrors.get(providerId);
  }

  errors(): string[] {
    const configError = this.config.getError();
    return [
      ...(configError !== undefined && configError !== "" ? [configError] : []),
      ...[...this.compositionErrors].map(
        ([providerId, error]) => `Provider "${providerId}": ${error}`,
      ),
    ];
  }

  configProvider(providerId: string) {
    return this.config.getProvider(providerId);
  }

  extensionConfig(providerId: string): modelRuntimeTypes.ProviderConfigInput | undefined {
    return this.extensionProviders.get(providerId);
  }

  nativeProvider(providerId: string): aiTypes.Provider | undefined {
    return this.nativeProviders.get(providerId);
  }

  registeredIds(): readonly string[] {
    return [...new Set([...this.extensionProviders.keys(), ...this.nativeProviders.keys()])];
  }

  registerNative(provider: aiTypes.Provider): void {
    if (provider.id.trim() === "") throw new Error("Provider id must not be empty.");
    this.extensionProviders.delete(provider.id);
    this.nativeProviders.set(provider.id, provider);
    this.recompose(provider.id);
  }

  registerExtension(
    providerId: string,
    config: modelRuntimeTypes.ProviderConfigInput,
  ): modelRuntimeTypes.ProviderConfigInput {
    validateExtensionProvider(
      providerId,
      this.builtins.get(providerId),
      this.config.getProvider(providerId),
      config,
    );
    this.nativeProviders.delete(providerId);
    const effective: modelRuntimeTypes.ProviderConfigInput = {
      ...this.extensionProviders.get(providerId),
      ...Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
    };
    this.extensionProviders.set(providerId, effective);
    this.recompose(providerId);
    return effective;
  }

  unregister(providerId: string): void {
    this.extensionProviders.delete(providerId);
    this.nativeProviders.delete(providerId);
    this.recompose(providerId);
  }

  private providerIds(): Set<string> {
    return new Set([
      ...this.builtins.keys(),
      ...this.nativeProviders.keys(),
      ...this.config.getProviderIds(),
      ...this.extensionProviders.keys(),
      ...this.virtualModels.providerIds(),
    ]);
  }

  private compose(providerId: string): aiTypes.Provider | undefined {
    const base = this.nativeProviders.get(providerId) ?? this.builtins.get(providerId);
    const extension = this.extensionProviders.get(providerId);
    if (this.config.getProvider(providerId) === undefined && extension === undefined) {
      this.compositionErrors.delete(providerId);
      return base;
    }
    try {
      const provider = composeModelProvider(providerId, base, this.config, extension);
      this.compositionErrors.delete(providerId);
      return provider;
    } catch (error) {
      this.compositionErrors.set(providerId, toErrorMessage(error));
      return base;
    }
  }
}
