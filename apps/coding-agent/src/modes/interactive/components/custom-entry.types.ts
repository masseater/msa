import type CustomEntryComponentClass from "./custom-entry.ts";

declare namespace customEntryTypes {
  type CustomEntryComponent = (typeof CustomEntryComponentClass)["prototype"];
}

export type { customEntryTypes as default };
