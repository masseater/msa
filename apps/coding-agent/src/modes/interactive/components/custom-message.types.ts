import type CustomMessageComponentClass from "./custom-message.ts";

declare namespace customMessageTypes {
  type CustomMessageComponent = (typeof CustomMessageComponentClass)["prototype"];
}

export type { customMessageTypes as default };
