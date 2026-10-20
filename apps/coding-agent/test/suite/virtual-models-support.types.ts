import type extensionsTypes from "../../src/core/extensions/index.types.ts";
import type virtualModelsTypes from "../../src/core/virtual-models.types.ts";

declare namespace virtualModelsSupportTypes {
  type Route = (
    request: virtualModelsTypes.ModelRouteRequest,
    ctx: extensionsTypes.ExtensionContext,
  ) => virtualModelsTypes.ModelRoute;
}

export type { virtualModelsSupportTypes as default };
