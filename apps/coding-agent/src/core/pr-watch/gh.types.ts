import type { Effect } from "effect";

import type execTypes from "../exec.types.ts";
import type PrWatchGhErrorClass from "./pr-watch-gh-error.ts";
import type snapshotTypes from "./snapshot.types.ts";

declare namespace ghTypes {
  type PrWatchFailure = "missing" | "auth" | "not-found" | "rate-limit" | "other";

  interface PrWatchGh {
    readonly view: (
      target: snapshotTypes.PrWatchTarget,
    ) => Effect.Effect<snapshotTypes.PrSnapshot, PrWatchGhError>;
    readonly behind: (
      target: snapshotTypes.PrWatchTarget,
      baseRefName: string,
      headRefOid: string,
    ) => Effect.Effect<number, PrWatchGhError>;
  }

  interface PrWatchGhOptions {
    readonly cwd: string;
    readonly find?: (executable: string) => string | null;
    readonly run?: (args: string[]) => Promise<execTypes.ExecResult>;
  }

  type PrWatchGhError = (typeof PrWatchGhErrorClass)["prototype"];
}

export type { ghTypes as default };
