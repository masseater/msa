import type { Context } from "@msa/chord";
import type envTypes from "@msa/durable/env.types";

import type fileOpTypes from "./file-op.types.ts";
import type watchTypes from "./watch.types.ts";

declare namespace watchOpTypes {
  interface WatchRequest {
    readonly target: fileOpTypes.RemoteTarget;
    readonly targets: readonly envTypes.WatchTarget[];
    readonly onChange: (change: envTypes.WatchChange) => void;
    readonly options: watchTypes.RemoteWatchOptions;
    readonly context: Context;
  }
}

export type { watchOpTypes as default };
