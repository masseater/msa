import type aiTypes from "@msa/ai/index.types";

import type CredentialSynchronizationErrorClass from "./credential-synchronization-error.ts";
import type ModelRuntimeClass from "./model-runtime.ts";

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

  type CredentialSynchronizationOperation =
    | "login"
    | "logout"
    | "setRuntimeApiKey"
    | "removeRuntimeApiKey";

  type CredentialSynchronizationError = (typeof CredentialSynchronizationErrorClass)["prototype"];

  type ModelRuntime = (typeof ModelRuntimeClass)["prototype"];
}

export type { modelRuntimeTypes as default };
