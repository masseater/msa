import type typesApiEventsTypes from "./types-api-events.ts";
import type typesApiRegistrationTypes from "./types-api-registration.ts";
import type typesApiSessionTypes from "./types-api-session.ts";

declare namespace typesApiTypes {
  interface ExtensionAPI
    extends
      typesApiEventsTypes.ExtensionEventApi,
      typesApiRegistrationTypes.ExtensionRegistrationApi,
      typesApiSessionTypes.ExtensionSessionApi {}
}

export type { typesApiTypes as default };
