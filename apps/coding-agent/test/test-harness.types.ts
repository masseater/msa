import type fauxModelTypes from "./harness/faux-model.types.ts";
import type fauxStreamTypes from "./harness/faux-stream.types.ts";
import type sessionTypesModule from "./harness/session-types.ts";

declare namespace testHarnessTypes {
  type FauxResponse = fauxModelTypes.FauxResponse;

  type FauxResponseInput = fauxModelTypes.FauxResponseInput;

  type FauxStreamFnState = fauxStreamTypes.FauxStreamFnState;

  type Harness = sessionTypesModule.Harness;

  type HarnessOptions = sessionTypesModule.HarnessOptions;
}

export type { testHarnessTypes as default };
