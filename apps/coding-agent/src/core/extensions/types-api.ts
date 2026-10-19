import type { ExtensionEventApi } from "./types-api-events.ts";
import type { ExtensionRegistrationApi } from "./types-api-registration.ts";
import type { ExtensionSessionApi } from "./types-api-session.ts";

export interface ExtensionAPI
  extends ExtensionEventApi, ExtensionRegistrationApi, ExtensionSessionApi {}
