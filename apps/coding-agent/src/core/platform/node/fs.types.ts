import type {
  FSWatcher as FSWatcherSource,
  Stats as StatsSource,
  WatchListener as WatchListenerSource,
  WriteStream as WriteStreamSource,
} from "node:fs";

declare namespace nodeFsTypes {
  type FSWatcher = FSWatcherSource;
  type Stats = StatsSource;
  type WatchListener<T> = WatchListenerSource<T>;
  type WriteStream = WriteStreamSource;
}

export type { nodeFsTypes as default };
