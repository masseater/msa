import type envTypes from "@msa/durable/env.types";
import type { Effect } from "effect";

declare namespace differentialSupportTypes {
  interface Root {
    readonly path: string;
    readonly real: string;
  }

  interface Pair {
    readonly local: envTypes.ExecutionEnv;
    readonly remote: envTypes.ExecutionEnv;
    readonly roots: [Root, Root];
  }

  interface Pairs {
    readonly pair: Effect.Effect<Pair>;
    readonly close: () => Promise<void>;
  }
}

export type { differentialSupportTypes as default };
