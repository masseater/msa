import type RunnerEmitApiClass from "./runner-emit-api.ts";

declare namespace runnerEmitApiTypes {
  type RunnerEmitApi = (typeof RunnerEmitApiClass)["prototype"];
}

export type { runnerEmitApiTypes as default };
