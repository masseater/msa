import type bridge from "./bridge.ts";

declare namespace bridgeTypes {
  type RuntimeError = (typeof bridge.RuntimeError)["prototype"];
}

export type { bridgeTypes as default };
