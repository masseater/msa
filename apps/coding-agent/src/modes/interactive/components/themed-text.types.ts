import type ThemedTextClass from "./themed-text.ts";

declare namespace themedTextTypes {
  type ThemedText = (typeof ThemedTextClass)["prototype"];
}

export type { themedTextTypes as default };
