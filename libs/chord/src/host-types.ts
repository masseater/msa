import { dual } from "effect/Function";

import type hostTypesModule from "./host-types.types.ts";

const defineFacet: {
  (
    options?: hostTypesModule.FacetUses,
  ): <P = unknown>(
    setup: (api: hostTypesModule.FacetApi<P>) => void,
  ) => hostTypesModule.FacetDefinition<P>;
  <P = unknown>(
    setup: (api: hostTypesModule.FacetApi<P>) => void,
    options?: hostTypesModule.FacetUses,
  ): hostTypesModule.FacetDefinition<P>;
} = dual(
  (args) => typeof args[0] === "function",
  <P = unknown>(
    setup: (api: hostTypesModule.FacetApi<P>) => void,
    options: hostTypesModule.FacetUses = {},
  ): hostTypesModule.FacetDefinition<P> => ({
    setup,
    uses: options.uses,
  }),
);

const isFacet = (ref: hostTypesModule.PluginRef): ref is hostTypesModule.Facet =>
  typeof ref === "object" && !(ref instanceof URL);

const hostTypes = {
  defineFacet,
  isFacet,
};

export default hostTypes;
