import type typesModule from "./types.ts";

declare namespace harnessTypes {
  type Harness = typesModule.Harness;

  type HarnessOptions = typesModule.HarnessOptions;
}

export type { harnessTypes as default };
