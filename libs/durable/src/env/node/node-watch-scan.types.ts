import type dualTypes from "../../dual.ts";
import type nodePathsTypes from "./node-paths.types.ts";
import type nodeWatchScopeTypes from "./node-watch-scope.types.ts";

declare namespace nodeWatchScanTypes {
  type WatchStats = nodePathsTypes.StatsLike & { readonly dev: number; readonly ino: number };

  interface ScanRequest {
    readonly targets: readonly nodeWatchScopeTypes.ResolvedTarget[];
    readonly mode: "native" | "polling";
    readonly maxDirectories: number;
  }

  type Dual2<A, B, R> = dualTypes.Dual2<A, B, R>;
}

export type { nodeWatchScanTypes as default };
