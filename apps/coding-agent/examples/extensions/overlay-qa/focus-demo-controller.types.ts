import type FocusDemoControllerClass from "./focus-demo-controller.ts";

declare namespace focusDemoControllerTypes {
  type FocusDemoController = (typeof FocusDemoControllerClass)["prototype"];
}

export type { focusDemoControllerTypes as default };
