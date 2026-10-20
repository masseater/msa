import type aiTypes from "@msa/ai/index.types";

import type ModelRegistryClass from "./model-registry.ts";
import type providerComposerTypes from "./provider-composer.types.ts";

declare namespace modelRegistryTypes {
  type ResolvedRequestAuth =
    | {
        ok: true;
        apiKey?: string | undefined;
        headers?: aiTypes.ProviderHeaders | undefined;
        baseUrl?: string | undefined;
        env?: Record<string, string> | undefined;
      }
    | { ok: false; error: string };

  type ModelRegistry = (typeof ModelRegistryClass)["prototype"];

  type ProviderConfigInput = providerComposerTypes.ProviderConfigInput;
}

export type { modelRegistryTypes as default };
