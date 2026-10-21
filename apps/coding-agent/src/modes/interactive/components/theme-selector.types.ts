import type ThemeSelectorComponentClass from "./theme-selector.ts";

declare namespace themeSelectorTypes {
  type ThemeSelectorComponent = (typeof ThemeSelectorComponentClass)["prototype"];
}

export type { themeSelectorTypes as default };
