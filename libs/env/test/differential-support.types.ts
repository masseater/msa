import type { ExecutionEnv } from "@msa/durable/env";
import type { Effect } from "effect";

declare namespace differentialSupportTypes {
  interface Root {
    readonly path: string;
    readonly real: string;
  }

  interface Pair {
    readonly local: ExecutionEnv;
    readonly remote: ExecutionEnv;
    readonly roots: [Root, Root];
  }

  interface Pairs {
    readonly pair: Effect.Effect<Pair>;
    readonly close: () => Promise<void>;
  }
}

export type { differentialSupportTypes as default };
