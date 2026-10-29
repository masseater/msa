import type { Effect } from "effect";

import type execTypes from "../exec.types.ts";
import type ciHistoryTypes from "./ci-history.types.ts";
import type PrWatchGhErrorClass from "./pr-watch-gh-error.ts";
import type snapshotTypes from "./snapshot.types.ts";

declare namespace ghTypes {
  type PrWatchFailure = PrWatchGhErrorClass["kind"];

  interface PrWatchGh {
    readonly view: (
      target: snapshotTypes.PrWatchTarget,
    ) => Effect.Effect<snapshotTypes.PrSnapshot, PrWatchGhError>;
    readonly behind: (
      target: snapshotTypes.PrWatchTarget,
      baseRefName: string,
      headRefOid: string,
    ) => Effect.Effect<number, PrWatchGhError>;
    readonly runs: (
      target: snapshotTypes.PrWatchTarget,
    ) => Effect.Effect<readonly ciHistoryTypes.CiRun[], PrWatchGhError>;
    readonly timeouts: (
      target: snapshotTypes.PrWatchTarget,
      headRefOid: string,
    ) => Effect.Effect<readonly ciHistoryTypes.WorkflowTimeout[], PrWatchGhError>;
  }

  interface PrWatchGhOptions {
    readonly cwd: string;
    readonly find?: (executable: string) => string | null;
    readonly run?: (args: string[]) => Promise<execTypes.ExecResult>;
  }

  type PrWatchGhError = (typeof PrWatchGhErrorClass)["prototype"];
}

export type { ghTypes as default };
