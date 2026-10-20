import { dual } from "effect/Function";

import nodeFs from "../core/platform/node/fs.ts";
import type nodeFsTypes from "../core/platform/node/fs.types.ts";

const { watch } = nodeFs;

const FS_WATCH_RETRY_DELAY_MS = 5000;

function closeWatcher(watcher: nodeFsTypes.FSWatcher | null | undefined): void {
  if (watcher === undefined || watcher === null) {
    return;
  }

  try {
    watcher.close();
  } catch {}
}

function watchWithErrorHandlerImpl(
  path: string,
  listener: nodeFsTypes.WatchListener<string>,
  onError: () => void,
): nodeFsTypes.FSWatcher | null {
  try {
    const watcher = watch(path, listener);
    watcher.on("error", onError);
    return watcher;
  } catch {
    onError();
    return null;
  }
}

const watchWithErrorHandler: {
  (
    path: string,
    listener: nodeFsTypes.WatchListener<string>,
    onError: () => void,
  ): nodeFsTypes.FSWatcher | null;
  (
    listener: nodeFsTypes.WatchListener<string>,
    onError: () => void,
  ): (path: string) => nodeFsTypes.FSWatcher | null;
} = dual((args: IArguments) => args.length >= 3, watchWithErrorHandlerImpl);

const fsWatch = {
  FS_WATCH_RETRY_DELAY_MS,
  closeWatcher,
  watchWithErrorHandler,
};

export default fsWatch;
