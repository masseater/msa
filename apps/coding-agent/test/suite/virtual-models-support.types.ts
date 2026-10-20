import type { ExtensionContext } from "../../src/core/extensions/index.ts";
import type { ModelRoute, ModelRouteRequest } from "../../src/core/virtual-models.ts";

declare namespace virtualModelsSupportTypes {
  type Route = (request: ModelRouteRequest, ctx: ExtensionContext) => ModelRoute;
}

export type { virtualModelsSupportTypes as default };
