import type { Draft } from "../../src/delta/draft.ts";
import type { Op } from "../../src/delta/index.ts";

declare namespace benchmarkWorkerModelTypes {
  type Mode = "tracker";

  type Scenario =
    | "import"
    | "committed-read"
    | "draft-read"
    | "sparse"
    | "queue"
    | "sort"
    | "dense"
    | "unshift"
    | "watch-authority-control"
    | "watch-live-borrowed"
    | "watch-acquire-shared"
    | "watch-acquire-detached"
    | "watch-acquire-staggered"
    | "watch-lag"
    | "watch-catch-up"
    | "watch-catch-up-coalesced"
    | "watch-live-immutable";

  type Row = { id: number; value: number; payload: string };

  type Document = { rows: Row[] };

  type PreparedLike = { readonly value: Readonly<Document>; readonly ops: readonly Op[] };

  type ChangeLike = { readonly state: Draft<Document>; prepare(): PreparedLike };

  type TrackerLike = {
    readonly value: Document;
    beginChange(): ChangeLike;
    adopt(prepared: PreparedLike): void;
  };

  type Frame = { readonly sequence: number; readonly ops: readonly Op[] };

  type WatchReplica = {
    value: Document;
    readonly baseSequence: number;
    sequence: number;
    readonly queue: Frame[];
  };

  interface MutationMetrics {
    readonly checksum: number;
    readonly mutateMs: number;
    readonly prepareMs: number;
    readonly serializeMs: number;
    readonly opBytes: number;
    readonly operationCount: number;
    readonly adoptMs: number;
  }

  interface MutationRun {
    readonly tracker: TrackerLike;
    readonly scenario: Scenario;
    readonly size: number;
    readonly queueOperations: number;
    readonly sample: () => void;
  }

  interface WorkerArguments {
    readonly mode: Mode;
    readonly scenario: Scenario;
    readonly size: number;
    readonly trial: number;
    readonly requestedWatchCount: number;
    readonly requestedWatchUpdates: number;
  }
}

export type { benchmarkWorkerModelTypes as default };
