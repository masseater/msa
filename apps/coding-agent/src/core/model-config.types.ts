import type { Static } from "typebox";

import type modelConfigSupport from "./model-config-support.ts";
import type ModelConfigClass from "./model-config.ts";

declare namespace modelConfigTypes {
  type ModelsJsonModel = Static<typeof modelConfigSupport.ModelDefinitionSchema>;

  type ModelsJsonModelOverride = Static<typeof modelConfigSupport.ModelOverrideSchema>;

  type ModelsJsonProvider = Static<typeof modelConfigSupport.ProviderConfigSchema>;

  type ModelConfig = (typeof ModelConfigClass)["prototype"];
}

export type { modelConfigTypes as default };
