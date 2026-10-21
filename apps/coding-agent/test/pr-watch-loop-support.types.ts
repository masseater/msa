import type ghTypes from "../src/core/pr-watch/gh.types.ts";
import type watchTypes from "../src/core/pr-watch/watch.types.ts";

declare namespace prWatchLoopSupportTypes {
  interface ScriptedGh {
    readonly gh: ghTypes.PrWatchGh;
    readonly calls: { count: number };
    readonly behindCalls: { count: number };
  }

  interface RunResult {
    readonly entry: watchTypes.PrWatchEntry;
    readonly notifications: watchTypes.PrNotification[];
    readonly changes: number;
    readonly calls: number;
    readonly behindCalls: number;
  }
}

export type { prWatchLoopSupportTypes as default };
