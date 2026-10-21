import type modelRegistryTypes from "../core/model-registry.types.ts";
import type modelResolverTypes from "../core/model-resolver.types.ts";
import type modelRuntimeTypes from "../core/model-runtime.types.ts";
import type virtualModelsTypes from "../core/virtual-models.types.ts";

declare namespace codingAgentModelsKitTypes {
  type ModelRegistry = modelRegistryTypes.ModelRegistry;
  type ModelScopeDiagnostic = modelResolverTypes.ModelScopeDiagnostic;
  type ResolveCliModelResult = modelResolverTypes.ResolveCliModelResult;
  type ResolveModelScopeResult = modelResolverTypes.ResolveModelScopeResult;
  type ScopedModel = modelResolverTypes.ScopedModel;
  type CreateModelRuntimeOptions = modelRuntimeTypes.CreateModelRuntimeOptions;
  type CredentialSynchronizationError = modelRuntimeTypes.CredentialSynchronizationError;
  type CredentialSynchronizationOperation = modelRuntimeTypes.CredentialSynchronizationOperation;
  type ModelRuntime = modelRuntimeTypes.ModelRuntime;
  type ModelRuntimeAuthOverrides = modelRuntimeTypes.ModelRuntimeAuthOverrides;
  type ModelRoute<TState = unknown> = virtualModelsTypes.ModelRoute<TState>;
  type ModelRouteReason = virtualModelsTypes.ModelRouteReason;
  type ModelRouteRequest<TState = unknown> = virtualModelsTypes.ModelRouteRequest<TState>;
  type VirtualModelDefinition<TState = unknown> = virtualModelsTypes.VirtualModelDefinition<TState>;
  type VirtualModelStateData<TState = unknown> = virtualModelsTypes.VirtualModelStateData<TState>;
}

export type { codingAgentModelsKitTypes as default };
