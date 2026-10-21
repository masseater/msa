import type SessionSelectorComponentClass from "./session-selector.ts";

declare namespace sessionSelectorTypes {
  type SessionSelectorComponent = (typeof SessionSelectorComponentClass)["prototype"];
}

export type { sessionSelectorTypes as default };
