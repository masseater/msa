import type UiControllerClass from "./controller.ts";

declare namespace controllerTypes {
  type UiController = (typeof UiControllerClass)["prototype"];
}

export type { controllerTypes as default };
