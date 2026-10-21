import type AssistantMessageComponentClass from "./assistant-message.ts";

declare namespace assistantMessageTypes {
  type AssistantMessageComponent = (typeof AssistantMessageComponentClass)["prototype"];
}

export type { assistantMessageTypes as default };
