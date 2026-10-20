import type { Effect } from "effect";

import type typesModule from "../types.types.ts";
import type fauxStreamTypes from "./faux-stream.types.ts";
import type fauxTypesModule from "./faux-types.ts";

declare namespace fauxEngineTypes {
  interface DeferredEntry {
    readonly handle: typesModule.DeferredHandle;
    readonly step: fauxTypesModule.FauxResponseStep;
    readonly context: typesModule.TranscriptContext;
    readonly options: typesModule.SimpleStreamOptions | undefined;
    readonly model: typesModule.Model<string>;
    pendingFetches: number;
    cancelled: boolean;
    final?: typesModule.AssistantMessage;
  }

  interface FauxEngine {
    readonly api: string;
    readonly provider: string;
    readonly state: fauxTypesModule.FauxProviderState;
    readonly promptCache: Map<string, readonly string[]>;
    readonly pacing: fauxStreamTypes.FauxPacing;
    readonly deferred: fauxTypesModule.RegisterFauxProviderOptions["deferred"];
    readonly deferredResponses: Map<string, DeferredEntry>;
  }

  interface FauxResponseRequest {
    readonly engine: FauxEngine;
    readonly step: fauxTypesModule.FauxResponseStep;
    readonly context: typesModule.TranscriptContext;
    readonly options: typesModule.SimpleStreamOptions | undefined;
    readonly model: typesModule.Model<string>;
  }

  interface DetachedStream {
    readonly engine: FauxEngine;
    readonly model: typesModule.Model<string>;
    readonly run: (stream: typesModule.AssistantMessageEventStream) => Effect.Effect<void>;
  }
}

export type { fauxEngineTypes as default };
