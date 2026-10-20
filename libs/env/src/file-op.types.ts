import type chordTypes from "@msa/chord/index.types";
import type envTypes from "@msa/durable/env.types";
import type { Effect } from "effect";

import type connectionTypes from "./connection.types.ts";
import type handleTypes from "./handle.types.ts";

declare namespace fileOpTypes {
  interface RemoteTarget {
    readonly connection: connectionTypes.Connection;
    readonly cwd: string;
  }

  interface PathRequest {
    readonly target: RemoteTarget;
    readonly path: string;
    readonly context: chordTypes.Context;
  }

  interface FileOp<T> extends PathRequest {
    readonly operation: (resolved: string) => Effect.Effect<T, envTypes.FileError>;
    readonly check?: "before" | "both";
  }

  interface ReaderOpen<R> extends PathRequest {
    readonly open: (resolved: string) => Effect.Effect<handleTypes.Handle>;
    readonly wrap: (handle: handleTypes.Handle) => R;
  }

  type Opened = { handle: handleTypes.Handle; json: connectionTypes.Json };

  interface RemoteRequest {
    readonly connection: connectionTypes.Connection;
    readonly op: string;
    readonly json: connectionTypes.Json;
    readonly payload?: Uint8Array;
  }
}

export type { fileOpTypes as default };
