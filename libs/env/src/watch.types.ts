import type watch from "./watch.ts";

declare namespace watchTypes {
  interface RemoteWatchOptions {
    mode?: "native" | "polling";
    pollIntervalMs?: number;
    maxDirectories?: number;
  }

  type RemoteWatcher = (typeof watch.RemoteWatcher)["prototype"];
}

export type { watchTypes as default };
