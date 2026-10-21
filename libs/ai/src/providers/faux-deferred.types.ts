import type typesModule from "../types.types.ts";
import type fauxEngineTypes from "./faux-engine.types.ts";
import type fauxTypesModule from "./faux-types.ts";

declare namespace fauxDeferredTypes {
  interface DeferredSubmission {
    readonly engine: fauxEngineTypes.FauxEngine;
    readonly stream: typesModule.AssistantMessageEventStream;
    readonly step: fauxTypesModule.FauxResponseStep;
    readonly context: typesModule.TranscriptContext;
    readonly options: typesModule.SimpleStreamOptions;
    readonly model: typesModule.Model<string>;
  }

  interface DeferredFetch {
    readonly engine: fauxEngineTypes.FauxEngine;
    readonly model: typesModule.Model<string>;
    readonly handle: typesModule.DeferredHandle;
    readonly options: typesModule.DeferredFetchOptions | undefined;
  }

  interface DeferredCancel {
    readonly engine: fauxEngineTypes.FauxEngine;
    readonly model: typesModule.Model<string>;
    readonly handle: typesModule.DeferredHandle;
    readonly options: typesModule.DeferredCancelOptions | undefined;
  }
}

export type { fauxDeferredTypes as default };
