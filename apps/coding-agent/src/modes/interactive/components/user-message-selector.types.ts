import type UserMessageSelectorComponentClass from "./user-message-selector.ts";

declare namespace userMessageSelectorTypes {
  type UserMessageSelectorComponent = (typeof UserMessageSelectorComponentClass)["prototype"];
}

export type { userMessageSelectorTypes as default };
