import type { Effect } from "effect";

import type typesModule from "./types.types.ts";

declare namespace bridgeTypes {
  type TaskChange<I, S, R> = (
    tx: typesModule.Tx,
    current: typesModule.RunningTask<I, S, R>,
  ) => Effect.Effect<typesModule.NextTaskState<S, R> | undefined>;
}

export type { bridgeTypes as default };
