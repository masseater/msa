import type fauxMessagesTypes from "./faux-messages.types.ts";
import type fauxTypesModule from "./faux-types.ts";

declare namespace fauxTypes {
  type FauxContentBlock = fauxMessagesTypes.FauxContentBlock;

  type FauxModelDefinition = fauxTypesModule.FauxModelDefinition;

  type FauxProviderHandle = fauxTypesModule.FauxProviderHandle;

  type FauxProviderRegistration = fauxTypesModule.FauxProviderRegistration;

  type FauxProviderState = fauxTypesModule.FauxProviderState;

  type FauxResponseFactory = fauxTypesModule.FauxResponseFactory;

  type FauxResponseStep = fauxTypesModule.FauxResponseStep;

  type RegisterFauxProviderOptions = fauxTypesModule.RegisterFauxProviderOptions;
}

export type { fauxTypes as default };
