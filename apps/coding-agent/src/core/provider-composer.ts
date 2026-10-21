import type aiTypes from "@msa/ai/index.types";

import type modelConfigTypes from "./model-config.types.ts";
import type providerComposerTypes from "./provider-composer.types.ts";
import ComposedProvider from "./provider-composer/composed-provider.ts";

function composeModelProvider(
  providerId: string,
  base: aiTypes.Provider | undefined,
  modelConfig: modelConfigTypes.ModelConfig,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): aiTypes.Provider {
  return new ComposedProvider(providerId, base, modelConfig, extension).build();
}

const providerComposer = { composeModelProvider };

export default providerComposer;
