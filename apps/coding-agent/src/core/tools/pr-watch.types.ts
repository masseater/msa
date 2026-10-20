import type { Static } from "typebox";

import type prWatch from "./pr-watch.ts";

declare namespace prWatchTypes {
  type PrWatchToolInput = Static<typeof prWatch.prWatchSchema>;

  interface PrWatchToolDetails {
    readonly action: string;
    readonly watching: readonly string[];
  }
}

export type { prWatchTypes as default };
