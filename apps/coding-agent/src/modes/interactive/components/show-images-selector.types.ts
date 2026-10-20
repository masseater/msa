import type ShowImagesSelectorComponentClass from "./show-images-selector.ts";

declare namespace showImagesSelectorTypes {
  type ShowImagesSelectorComponent = (typeof ShowImagesSelectorComponentClass)["prototype"];
}

export type { showImagesSelectorTypes as default };
