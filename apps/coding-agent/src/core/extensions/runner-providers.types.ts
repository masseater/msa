import type aiTypes from "@msa/ai/index.types";

import type virtualModelsTypes from "../virtual-models.types.ts";
import type ProviderBinderClass from "./runner-providers.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace runnerProvidersTypes {
  interface ProviderActions {
    registerProvider?: (name: string, config: extensionsTypesTypes.ProviderConfig) => void;
    registerNativeProvider?: (provider: aiTypes.Provider) => void;
    unregisterProvider?: (name: string) => void;
    registerVirtualModel?: (definition: virtualModelsTypes.VirtualModelDefinition) => void;
    unregisterVirtualModel?: (provider: string, id: string) => void;
  }

  type ProviderBinder = (typeof ProviderBinderClass)["prototype"];
}

export type { runnerProvidersTypes as default };
