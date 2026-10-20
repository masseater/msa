import type typesModule from "../types.types.ts";
import type modelsErrorTypes from "../utils/models-error.types.ts";
import type typesModuleModule from "./types.ts";

declare namespace resolveTypes {
  interface AuthProvider {
    id: string;
    auth: typesModuleModule.ProviderAuth;
  }

  interface AuthResolutionOverrides {
    apiKey?: string | undefined;
    env?: typesModule.ProviderEnv | undefined;
    minOAuthValidityMs?: number | undefined;
    signal?: AbortSignal | undefined;
  }

  type ModelsErrorCode = modelsErrorTypes.ModelsErrorCode;

  type ModelsError = modelsErrorTypes.ModelsError;
}

export type { resolveTypes as default };
