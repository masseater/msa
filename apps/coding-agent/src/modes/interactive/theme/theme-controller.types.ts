import type InteractiveThemeControllerClass from "./interactive-theme-controller.ts";

declare namespace themeControllerTypes {
  type InteractiveThemeController = (typeof InteractiveThemeControllerClass)["prototype"];
}

export type { themeControllerTypes as default };
