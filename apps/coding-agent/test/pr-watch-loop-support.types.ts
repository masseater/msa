import type { PrWatchGh } from "../src/core/pr-watch/gh.ts";
import type { PrNotification, PrWatchEntry } from "../src/core/pr-watch/watch.ts";

declare namespace prWatchLoopSupportTypes {
  interface ScriptedGh {
    readonly gh: PrWatchGh;
    readonly calls: { count: number };
    readonly behindCalls: { count: number };
  }

  interface RunResult {
    readonly entry: PrWatchEntry;
    readonly notifications: PrNotification[];
    readonly changes: number;
    readonly calls: number;
    readonly behindCalls: number;
  }
}

export type { prWatchLoopSupportTypes as default };
