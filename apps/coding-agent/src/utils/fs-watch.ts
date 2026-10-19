import { type FSWatcher, type WatchListener, watch } from "node:fs";

import { dual } from "effect/Function";

export const FS_WATCH_RETRY_DELAY_MS = 5000;

export function closeWatcher(watcher: FSWatcher | null | undefined): void {
  if (watcher === undefined || watcher === null) {
    return;
  }

  try {
    watcher.close();
  } catch {}
}

function watchWithErrorHandlerImpl(
  path: string,
  listener: WatchListener<string>,
  onError: () => void,
): FSWatcher | null {
  try {
    const watcher = watch(path, listener);
    watcher.on("error", onError);
    return watcher;
  } catch {
    onError();
    return null;
  }
}

export const watchWithErrorHandler: {
  (path: string, listener: WatchListener<string>, onError: () => void): FSWatcher | null;
  (listener: WatchListener<string>, onError: () => void): (path: string) => FSWatcher | null;
} = dual((args: IArguments) => args.length >= 3, watchWithErrorHandlerImpl);
