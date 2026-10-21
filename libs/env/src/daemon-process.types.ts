import type { Deferred } from "effect";

import type remoteErrorTypes from "./remote-error.types.ts";
import type sessionTypes from "./session.types.ts";

declare namespace daemonProcessTypes {
  type Launched = {
    session: sessionTypes.Session;
    failed: Deferred.Deferred<never, remoteErrorTypes.RemoteError>;
  };

  interface DaemonLaunch {
    readonly program: string;
    readonly args: readonly string[];
    readonly id: number;
    readonly startedAt: number;
    readonly onData: (session: sessionTypes.Session, chunk: Buffer) => void;
    readonly onLog: (text: string) => void;
    readonly onTick: (session: sessionTypes.Session) => void;
    readonly onLost: (session: sessionTypes.Session) => void;
  }
}

export type { daemonProcessTypes as default };
