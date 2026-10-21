import authStorageSupport from "../core/auth-storage-support.ts";
import cliModelFlag from "../core/cli-model.ts";
import CredentialSynchronizationError from "../core/credential-synchronization-error.ts";
import ModelRegistry from "../core/model-registry.ts";
import ModelRuntime from "../core/model-runtime.ts";
import runtimeModelScope from "../core/runtime-model-scope.ts";
import virtualModels from "../core/virtual-models.ts";

const modelsKit: {
  readonly CredentialSynchronizationError: typeof CredentialSynchronizationError;
  readonly ModelRegistry: typeof ModelRegistry;
  readonly ModelRuntime: typeof ModelRuntime;
  readonly VIRTUAL_MODEL_STATE_ENTRY: typeof virtualModels.VIRTUAL_MODEL_STATE_ENTRY;
  readonly readStoredCredential: typeof authStorageSupport.readStoredCredential;
  readonly resolveCliModel: typeof cliModelFlag.resolveCliModel;
  readonly resolveModelScopeWithDiagnostics: typeof runtimeModelScope.resolveModelScopeWithDiagnostics;
} = {
  CredentialSynchronizationError,
  ModelRegistry,
  ModelRuntime,
  VIRTUAL_MODEL_STATE_ENTRY: virtualModels.VIRTUAL_MODEL_STATE_ENTRY,
  readStoredCredential: authStorageSupport.readStoredCredential,
  resolveCliModel: cliModelFlag.resolveCliModel,
  resolveModelScopeWithDiagnostics: runtimeModelScope.resolveModelScopeWithDiagnostics,
};

export default modelsKit;
