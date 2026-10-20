import type fauxModelTypes from "./faux-model.types.ts";
import type fauxStreamTypes from "./faux-stream.types.ts";
import type sessionTypesModule from "./session-types.ts";

declare namespace harnessTypes {
  type FauxResponse = fauxModelTypes.FauxResponse;

  type FauxResponseInput = fauxModelTypes.FauxResponseInput;

  type FauxStreamFnState = fauxStreamTypes.FauxStreamFnState;

  type Harness = sessionTypesModule.Harness;

  type HarnessOptions = sessionTypesModule.HarnessOptions;
}

export type { harnessTypes as default };
