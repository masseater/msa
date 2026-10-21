import type UserMessageComponentClass from "./user-message.ts";

declare namespace userMessageTypes {
  type UserMessageComponent = (typeof UserMessageComponentClass)["prototype"];
}

export type { userMessageTypes as default };
