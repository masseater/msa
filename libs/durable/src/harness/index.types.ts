import type harnessSourceTypes from "./harness.types.ts";

declare namespace harnessTypes {
  type Harness = harnessSourceTypes.Harness;
}

export type { harnessTypes as default };
