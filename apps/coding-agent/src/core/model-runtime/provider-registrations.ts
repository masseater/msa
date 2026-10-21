import type aiTypes from "@msa/ai/index.types";

import type modelRuntimeTypes from "../model-runtime.types.ts";
import virtualModelsModule from "../virtual-models.ts";
import type ModelAuth from "./model-auth.ts";
import type ModelAvailability from "./model-availability.ts";
import type ProviderCatalog from "./provider-catalog.ts";
import type VirtualModelRegistry from "./virtual-model-registry.ts";

const { isVirtualModel } = virtualModelsModule;

interface RegistrationParts {
  models: aiTypes.MutableModels;
  catalog: ProviderCatalog;
  availability: ModelAvailability;
  auth: ModelAuth;
  virtualModels: VirtualModelRegistry;
  refresh: () => void;
}

export default class ProviderRegistrations {
  private readonly parts: RegistrationParts;

  constructor(parts: RegistrationParts) {
    this.parts = parts;
  }

  registerNative(provider: aiTypes.Provider): void {
    this.parts.catalog.registerNative(provider);
    const oauthOnly = provider.auth.oauth !== undefined && provider.auth.apiKey === undefined;
    this.afterRegistration(provider.id, undefined, oauthOnly ? "oauth" : "api_key");
  }

  registerExtension(providerId: string, config: modelRuntimeTypes.ProviderConfigInput): void {
    const effective = this.parts.catalog.registerExtension(providerId, config);
    const oauthOnly =
      effective.oauth !== undefined && (effective.apiKey === undefined || effective.apiKey === "");
    this.afterRegistration(providerId, effective, oauthOnly ? "oauth" : "api_key");
  }

  unregister(providerId: string): void {
    this.parts.catalog.unregister(providerId);
    this.parts.availability.updateModels();
    this.parts.refresh();
  }

  registerVirtual(definition: modelRuntimeTypes.VirtualModelDefinition): void {
    const { provider: providerId, id } = definition;
    if (providerId.trim() === "" || id.trim() === "")
      throw new Error("Virtual model provider and id must not be empty.");
    const existing = this.parts.models.getModel(providerId, id);
    if (existing !== undefined && !isVirtualModel(existing)) {
      throw new Error(`Virtual model ${providerId}/${id} conflicts with a physical model.`);
    }
    this.parts.virtualModels.add(definition);
    if (this.parts.catalog.recompose(providerId) === undefined) {
      this.parts.availability.markVirtualConfigured(providerId);
    }
    this.parts.availability.updateModels();
    this.parts.refresh();
  }

  unregisterVirtual(providerId: string, id: string): void {
    if (!this.parts.virtualModels.remove(providerId, id)) return;
    this.parts.catalog.recompose(providerId);
    this.parts.availability.updateModels();
    this.parts.refresh();
  }

  private afterRegistration(
    providerId: string,
    extension: modelRuntimeTypes.ProviderConfigInput | undefined,
    type: aiTypes.AuthType,
  ): void {
    const { auth, availability } = this.parts;
    availability.updateModels();
    if (
      availability.isStored(providerId) ||
      auth.configuredStatus(providerId, extension)?.configured === true
    ) {
      availability.markConfigured(providerId, { source: "configured provider", type });
    }
    this.parts.refresh();
  }
}
