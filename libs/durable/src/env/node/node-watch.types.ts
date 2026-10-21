import type envTypes from "../index.types.ts";
import type nodeTimerTypes from "./node-timer.types.ts";
import type nodeWatchErrorsTypes from "./node-watch-errors.types.ts";
import type NodeFileWatcherClass from "./node-watch.ts";

declare namespace nodeWatchTypes {
  interface NodeWatchOptions {
    mode?: "native" | "polling";
    pollIntervalMs?: number;
    maxDirectories?: number;
  }

  type NodeFileWatcher = NodeFileWatcherClass;

  type Timer = nodeTimerTypes.Timer;

  type BudgetExceeded = nodeWatchErrorsTypes.BudgetExceeded;

  type FileWatcher = envTypes.FileWatcher;

  type WatchChange = envTypes.WatchChange;

  type WatchTarget = envTypes.WatchTarget;
}

export type { nodeWatchTypes as default };
