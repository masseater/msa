import type dualTypes from "../../dual.ts";

declare namespace nodePathsTypes {
  type StatsLike = {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    readonly size: number;
    readonly mtimeMs: number;
  };

  type Dual2<A, B, R> = dualTypes.Dual2<A, B, R>;
}

export type { nodePathsTypes as default };
