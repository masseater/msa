import type benchmarkWorkerModelTypes from "./benchmark-worker-model.types.ts";

declare namespace benchmarkRunTypes {
  type Document = benchmarkWorkerModelTypes.Document;
  type Listener = (value: Document, sequence: number) => number;

  interface Metrics {
    acquireMs: number;
    adoptMs: number;
    authoritySequence: number;
    checksum: number;
    deliveryMs: number;
    enqueueMs: number;
    mutateMs: number;
    opBytes: number;
    operationCount: number;
    peakHeap: number;
    postAcquireRetainedMiB: number;
    postDeliveryRetainedMiB: number;
    postLagRetainedMiB: number;
    prepareMs: number;
    sampledAcquireMiB: number;
    serializeMs: number;
  }

  interface Run {
    readonly baselineHeap: number;
    readonly listeners: Listener[];
    readonly metrics: Metrics;
    readonly readyHeap: number;
    readonly scenario: benchmarkWorkerModelTypes.Scenario;
    readonly size: number;
    readonly tracker: benchmarkWorkerModelTypes.TrackerLike;
    readonly watchCount: number;
    readonly watchUpdateTarget: number;
    readonly watchers: benchmarkWorkerModelTypes.WatchReplica[];
  }
}

export type { benchmarkRunTypes as default };
