import type aiTypes from "@msa/ai/index.types";

import type CredentialSynchronizationErrorClass from "./credential-synchronization-error.ts";
import type modelPolicyTypes from "./model-policy.types.ts";
import type ModelRuntimeClass from "./model-runtime.ts";
import type providerComposerTypes from "./provider-composer.types.ts";
import type virtualModelsTypes from "./virtual-models.types.ts";

declare namespace modelRuntimeTypes {
  interface CreateModelRuntimeOptions {
    credentials?: aiTypes.CredentialStore | undefined;
    authPath?: string | undefined;
    modelsPath?: string | null | undefined;
    modelsStore?: aiTypes.ModelsStore | undefined;
    modelsStorePath?: string | undefined;
    allowModelNetwork?: boolean | undefined;
    modelRefreshTimeoutMs?: number | undefined;
    catalogBaseUrl?: string | undefined;
    signal?: AbortSignal | undefined;
    refreshOnCreate?: boolean | undefined;
  }

  interface ModelRuntimeAuthOverrides extends aiTypes.AuthOperationOptions {
    apiKey?: string | undefined;
    env?: Record<string, string> | undefined;
    minOAuthValidityMs?: number | undefined;
  }

  type CredentialSynchronizationOperation = CredentialSynchronizationErrorClass["operation"];

  type CredentialSynchronizationError = (typeof CredentialSynchronizationErrorClass)["prototype"];

  type ModelRuntime = (typeof ModelRuntimeClass)["prototype"];

  type ModelPolicy = modelPolicyTypes.ModelPolicy;

  type ProviderConfigInput = providerComposerTypes.ProviderConfigInput;

  type ProviderAuthStatus = providerComposerTypes.AuthStatus;

  type CompatibilityRequestConfig = providerComposerTypes.CompatibilityRequestConfig;

  type VirtualModelDefinition = virtualModelsTypes.VirtualModelDefinition;

  type ModelRoute = virtualModelsTypes.ModelRoute;

  interface ModelRouteOptions {
    reason: virtualModelsTypes.ModelRouteReason;
    thinkingLevel: aiTypes.ModelThinkingLevel;
    signal?: AbortSignal | undefined;
    failed?: aiTypes.AssistantMessage | undefined;
    state?: unknown;
  }
}

export type { modelRuntimeTypes as default };
