import type PassiveDemoControllerClass from "./passive-demo-controller.ts";

declare namespace passiveDemoControllerTypes {
  type PassiveDemoController = (typeof PassiveDemoControllerClass)["prototype"];
}

export type { passiveDemoControllerTypes as default };
