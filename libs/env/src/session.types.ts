import type { Cause, Queue, Scope } from "effect";

import type remoteErrorTypes from "./remote-error.types.ts";
import type sessionModule from "./session.ts";

declare namespace sessionTypes {
  interface Reply {
    json: remoteErrorTypes.Json;
    payload: Uint8Array;
    session: number;
  }

  type Pending = {
    resolve: (value: Reply) => void;
    reject: (error: Error) => void;
    onEvent?: (json: remoteErrorTypes.Json, payload: Uint8Array) => void;
  };

  interface SessionStart {
    readonly id: number;
    readonly input: Queue.Queue<Uint8Array, Cause.Done>;
    readonly scope: Scope.Closeable;
    readonly token: string;
    readonly now: number;
  }

  type Session = (typeof sessionModule.Session)["prototype"];
}

export type { sessionTypes as default };
