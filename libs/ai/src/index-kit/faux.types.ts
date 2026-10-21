import type fauxMessagesTypes from "../providers/faux-messages.types.ts";
import type fauxTypesModule from "../providers/faux-types.ts";

declare namespace aiFauxKitTypes {
  type FauxContentBlock = fauxMessagesTypes.FauxContentBlock;
  type FauxModelDefinition = fauxTypesModule.FauxModelDefinition;
  type FauxProviderHandle = fauxTypesModule.FauxProviderHandle;
  type FauxProviderRegistration = fauxTypesModule.FauxProviderRegistration;
  type FauxProviderState = fauxTypesModule.FauxProviderState;
  type FauxResponseFactory = fauxTypesModule.FauxResponseFactory;
  type FauxResponseStep = fauxTypesModule.FauxResponseStep;
  type RegisterFauxProviderOptions = fauxTypesModule.RegisterFauxProviderOptions;
}

export type { aiFauxKitTypes as default };
