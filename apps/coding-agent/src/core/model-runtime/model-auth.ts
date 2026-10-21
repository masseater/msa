import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import requestConfig from "../provider-composer/request-config.ts";
import type runtimeCredentialsTypes from "../runtime-credentials.types.ts";
import type ModelAvailability from "./model-availability.ts";
import type ProviderCatalog from "./provider-catalog.ts";

const { awaited, awaitingWith } = awaitingModule;
const {
  configuredRequestAuthStatus,
  mergeHeaders,
  resolveCompatibilityRequestConfig,
  resolveConfiguredModelHeaders,
} = requestConfig;

export default class ModelAuth {
  private readonly models: aiTypes.MutableModels;
  private readonly credentials: runtimeCredentialsTypes.RuntimeCredentials;
  private readonly catalog: ProviderCatalog;
  private readonly availability: ModelAvailability;

  constructor(
    models: aiTypes.MutableModels,
    credentials: runtimeCredentialsTypes.RuntimeCredentials,
    catalog: ProviderCatalog,
    availability: ModelAvailability,
  ) {
    this.models = models;
    this.credentials = credentials;
    this.catalog = catalog;
    this.availability = availability;
  }

  getAuth(
    providerOrModel: string | aiTypes.AnyModel,
    overrides: modelRuntimeTypes.ModelRuntimeAuthOverrides,
  ): Promise<aiTypes.AuthResult | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (typeof providerOrModel === "string")
          return yield* awaited(this.models.getAuth(providerOrModel, overrides));
        const resolution = yield* awaited(this.models.getAuth(providerOrModel, overrides));
        if (resolution === undefined) return undefined;
        const configuredHeaders = resolveConfiguredModelHeaders(
          providerOrModel,
          this.catalog.configProvider(providerOrModel.provider),
          this.catalog.extensionConfig(providerOrModel.provider),
          { ...(resolution.env ?? {}), ...(overrides.env ?? {}) },
        );
        return {
          ...resolution,
          auth: {
            ...resolution.auth,
            headers: mergeHeaders(resolution.auth.headers, configuredHeaders),
          },
        };
      }, this),
    );
  }

  compatibilityConfig(
    model: aiTypes.Model<aiTypes.Api>,
  ): modelRuntimeTypes.CompatibilityRequestConfig {
    return resolveCompatibilityRequestConfig(
      model,
      this.catalog.configProvider(model.provider),
      this.catalog.extensionConfig(model.provider),
    );
  }

  configuredStatus(
    providerId: string,
    extension: modelRuntimeTypes.ProviderConfigInput | undefined,
  ): modelRuntimeTypes.ProviderAuthStatus | undefined {
    return configuredRequestAuthStatus(this.catalog.configProvider(providerId), extension);
  }

  status(providerId: string): modelRuntimeTypes.ProviderAuthStatus {
    if (this.credentials.hasRuntimeApiKey(providerId))
      return { configured: true, source: "runtime" };
    if (this.availability.isStored(providerId)) return { configured: true, source: "stored" };
    const configured = this.configuredStatus(providerId, this.catalog.extensionConfig(providerId));
    if (configured !== undefined) return configured;
    const check = this.availability.authCheck(providerId);
    return check === undefined
      ? { configured: false }
      : { configured: true, label: check.source, source: "environment" };
  }
}
