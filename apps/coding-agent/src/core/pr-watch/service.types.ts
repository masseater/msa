import type ghTypes from "./gh.types.ts";
import type PrWatchClass from "./service.ts";
import type watchTypes from "./watch.types.ts";

declare namespace serviceTypes {
  interface PrWatchOptions {
    readonly gh: ghTypes.PrWatchGh;
    readonly host: watchTypes.PrWatchHost;
    readonly defaultIntervalMs: () => number;
    readonly statusIntervalMs: () => number;
  }

  interface PrWatchStart {
    readonly entry: watchTypes.PrWatchEntry;
    readonly started: boolean;
  }

  interface PrWatchLastNotification {
    readonly key: string;
    readonly target: string;
    readonly change: string;
  }

  interface PrWatchSnapshot {
    readonly entries: readonly watchTypes.PrWatchEntry[];
    readonly last: PrWatchLastNotification | undefined;
  }

  type PrWatch = (typeof PrWatchClass)["prototype"];
}

export type { serviceTypes as default };
