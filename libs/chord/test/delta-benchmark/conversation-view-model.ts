import type conversationViewModelTypes from "./conversation-view-model.types.ts";
const PROVISIONAL_SCHEMA = "pico5.conversation-view.provisional.v0";

const modes: readonly conversationViewModelTypes.Mode[] = ["tracker"];
const scenarios: readonly conversationViewModelTypes.Scenario[] = [
  "projection-control",
  "normal",
  "fanout",
  "delayed-start-lag",
  "churn-reconnect",
  "overflow-reset",
  "branch-head-replacement",
];
const phaseNames: readonly conversationViewModelTypes.PhaseName[] = [
  "mutation",
  "prepare",
  "adopt",
  "synthesize",
  "projectApply",
  "project",
  "enqueue",
  "sessionLine",
  "delivery",
  "opSerialize",
  "resetSerialize",
  "conversationAcquire",
  "documentAcquire",
  "conversationSerialize",
  "documentSerialize",
  "resetClone",
];
const numericMetrics: readonly conversationViewModelTypes.NumericResultKey[] = [
  "initialAggregateBytes",
  "conversationSequence",
  "publishedAggregateBatches",
  "publishedDocumentBatches",
  "conversationRegistrations",
  "documentRegistrations",
  "conversationBaseBytes",
  "documentBaseBytes",
  "noOpCommitCount",
  "unmountedCommitCount",
  "resetCount",
  "resetBytes",
  "deliveryFrameReferences",
  "deliveryOperationReferences",
  "aggregateOperationCount",
  "aggregateOperationBytes",
  "documentOperationCount",
  "documentOperationBytes",
  "peakQueueReferences",
  "peakQueuedOperationReferences",
  "peakPendingOperationsPerWatch",
  "peakUniqueQueuedBatches",
  "finalQueueReferences",
  "finalQueuedOperationReferences",
  "finalUniqueQueuedBatches",
  "authorityReadyMiB",
  "postAcquireRetainedMiB",
  "postWorkRetainedMiB",
  "postVerificationRetainedMiB",
  "releaseHeapMiB",
  "releaseTotalMiB",
  "peakHeapMiB",
  "peakTotalHeapMiB",
  "maxRssMiB",
];

const conversationViewModel = {
  PROVISIONAL_SCHEMA,
  modes,
  numericMetrics,
  phaseNames,
  scenarios,
};

export default conversationViewModel;
