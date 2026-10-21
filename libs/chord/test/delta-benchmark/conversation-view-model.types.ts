declare namespace conversationViewModelTypes {
  type Mode = "tracker";

  type Scenario =
    | "projection-control"
    | "normal"
    | "fanout"
    | "delayed-start-lag"
    | "churn-reconnect"
    | "overflow-reset"
    | "branch-head-replacement";

  type Distribution = {
    count: number;
    totalMs: number;
    medianMs: number;
    p95Ms: number;
    p99Ms: number;
    minMs: number;
    maxMs: number;
  };

  type PhaseName =
    | "mutation"
    | "prepare"
    | "adopt"
    | "synthesize"
    | "projectApply"
    | "project"
    | "enqueue"
    | "sessionLine"
    | "delivery"
    | "opSerialize"
    | "resetSerialize"
    | "conversationAcquire"
    | "documentAcquire"
    | "conversationSerialize"
    | "documentSerialize"
    | "resetClone";

  type Result = {
    mode: Mode;
    scenario: Scenario;
    trial: number;
    provisionalSchema: string;
    headlineEntries: number;
    commitTarget: number;
    initialAggregateBytes: number;
    conversationWatchCount: number;
    documentWatchCount: number;
    queueCapacity: number | null;
    queueCapacityUnit: "pending-operations";
    deliveryModel: "async-serialized-ops-only-no-consumer-apply";
    conversationSequence: number;
    documentSequences: Record<string, number>;
    publishedAggregateBatches: number;
    publishedDocumentBatches: number;
    conversationRegistrations: number;
    documentRegistrations: number;
    conversationBaseBytes: number;
    documentBaseBytes: number;
    noOpCommitCount: number;
    unmountedCommitCount: number;
    resetCount: number;
    resetBytes: number;
    deliveryFrameReferences: number;
    deliveryOperationReferences: number;
    aggregateOperationCount: number;
    aggregateOperationBytes: number;
    documentOperationCount: number;
    documentOperationBytes: number;
    peakQueueReferences: number;
    peakQueuedOperationReferences: number;
    peakPendingOperationsPerWatch: number;
    peakUniqueQueuedBatches: number;
    finalQueueReferences: number;
    finalQueuedOperationReferences: number;
    finalUniqueQueuedBatches: number;
    phaseDistributions: Record<PhaseName, Distribution>;
    authorityReadyMiB: number;
    postAcquireRetainedMiB: number;
    postWorkRetainedMiB: number;
    postVerificationRetainedMiB: number;
    releaseHeapMiB: number;
    releaseTotalMiB: number;
    peakHeapMiB: number;
    peakTotalHeapMiB: number;
    maxRssMiB: number;
    checksum: number;
  };

  type Failure = { mode: Mode; scenario: Scenario; trial: number; stderr: string };

  type NumericResultKey =
    | "initialAggregateBytes"
    | "conversationSequence"
    | "publishedAggregateBatches"
    | "publishedDocumentBatches"
    | "conversationRegistrations"
    | "documentRegistrations"
    | "conversationBaseBytes"
    | "documentBaseBytes"
    | "noOpCommitCount"
    | "unmountedCommitCount"
    | "resetCount"
    | "resetBytes"
    | "deliveryFrameReferences"
    | "deliveryOperationReferences"
    | "aggregateOperationCount"
    | "aggregateOperationBytes"
    | "documentOperationCount"
    | "documentOperationBytes"
    | "peakQueueReferences"
    | "peakQueuedOperationReferences"
    | "peakPendingOperationsPerWatch"
    | "peakUniqueQueuedBatches"
    | "finalQueueReferences"
    | "finalQueuedOperationReferences"
    | "finalUniqueQueuedBatches"
    | "authorityReadyMiB"
    | "postAcquireRetainedMiB"
    | "postWorkRetainedMiB"
    | "postVerificationRetainedMiB"
    | "releaseHeapMiB"
    | "releaseTotalMiB"
    | "peakHeapMiB"
    | "peakTotalHeapMiB"
    | "maxRssMiB";

  type SummaryValue = { median: number | null; range: readonly [number, number] | null };
}

export type { conversationViewModelTypes as default };
