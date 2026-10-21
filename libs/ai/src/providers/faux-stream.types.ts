import type typesModule from "../types.types.ts";

declare namespace fauxStreamTypes {
  interface FauxPacing {
    readonly minTokenSize: number;
    readonly maxTokenSize: number;
    readonly tokensPerSecond: number | undefined;
  }

  interface FauxDelivery {
    readonly stream: typesModule.AssistantMessageEventStream;
    readonly message: typesModule.AssistantMessage;
    readonly pacing: FauxPacing;
    readonly signal: AbortSignal | undefined;
  }
}

export type { fauxStreamTypes as default };
