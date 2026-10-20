import type { Context } from "@msa/chord";
import type { WatchChange, WatchTarget } from "@msa/durable/env";

import type fileOpTypes from "./file-op.types.ts";
import type watchTypes from "./watch.types.ts";

declare namespace watchOpTypes {
  interface WatchRequest {
    readonly target: fileOpTypes.RemoteTarget;
    readonly targets: readonly WatchTarget[];
    readonly onChange: (change: WatchChange) => void;
    readonly options: watchTypes.RemoteWatchOptions;
    readonly context: Context;
  }
}

export type { watchOpTypes as default };
