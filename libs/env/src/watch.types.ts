import type RemoteWatcherClass from "./watch.ts";

declare namespace watchTypes {
  interface RemoteWatchOptions {
    mode?: "native" | "polling";
    pollIntervalMs?: number;
    maxDirectories?: number;
  }

  type RemoteWatcher = RemoteWatcherClass;
}

export type { watchTypes as default };
