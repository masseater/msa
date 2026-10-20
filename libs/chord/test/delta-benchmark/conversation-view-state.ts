import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import type { JsonValue } from "../../src/delta/index.ts";
import benchmarkWorkerModel from "./benchmark-worker-model.ts";
import conversationViewContent from "./conversation-view-content.ts";
import initialDocuments from "./conversation-view-documents.ts";
import conversationViewModel from "./conversation-view-model.ts";
import type conversationViewModelTypes from "./conversation-view-model.types.ts";
import conversationViewTypes from "./conversation-view-types.ts";
import type conversationViewModuleTypes from "./conversation-view-types.types.ts";

const { cloneTrusted } = benchmarkWorkerModel;
const { createTracker, entryKindAt, makeEntry, resolveActiveLineage } = conversationViewContent;
const { PROVISIONAL_SCHEMA, phaseNames } = conversationViewModel;
const { MOUNTED_KEYS } = conversationViewTypes;

const emptySamples = (): conversationViewModuleTypes.PhaseSamples =>
  Object.fromEntries(
    phaseNames.map((name): [conversationViewModelTypes.PhaseName, number[]] => [name, []]),
  ) as conversationViewModuleTypes.PhaseSamples;

class ConversationViewState {
  readonly phaseSamples = emptySamples();
  readonly records = new Map<number, conversationViewModuleTypes.TranscriptEntry>();
  head: number | null = null;
  nextEntryId = 1;
  readonly documentTrackers: Record<
    conversationViewModuleTypes.DocumentKey,
    conversationViewModuleTypes.TrackerLike<conversationViewModuleTypes.JsonObject>
  >;
  aggregate: conversationViewModuleTypes.ConversationView;
  readonly initialAggregateBytes: number;
  conversationSequence = 0;
  readonly documentSequences: Record<conversationViewModuleTypes.DocumentKey, number>;
  conversationWatches: Array<
    conversationViewModuleTypes.Watch<conversationViewModuleTypes.ConversationView>
  > = [];
  documentWatches: conversationViewModuleTypes.DocumentWatch[] = [];
  queuedFrameReferences = 0;
  queuedOperationReferences = 0;
  readonly queuedFrameRefCounts = new Map<conversationViewModuleTypes.DeltaFrame, number>();
  peakQueueReferences = 0;
  peakQueuedOperationReferences = 0;
  peakPendingOperationsPerWatch = 0;
  peakUniqueQueuedBatches = 0;
  deliveryFrameReferences = 0;
  deliveryOperationReferences = 0;
  aggregateOperationCount = 0;
  aggregateOperationBytes = 0;
  documentOperationCount = 0;
  documentOperationBytes = 0;
  publishedAggregateBatches = 0;
  publishedDocumentBatches = 0;
  conversationRegistrations = 0;
  documentRegistrations = 0;
  conversationBaseBytes = 0;
  documentBaseBytes = 0;
  resetCount = 0;
  resetBytes = 0;
  noOpCommitCount = 0;
  unmountedCommitCount = 0;
  unmountedPublicationViolations = 0;
  sessionCommitCount = 0;
  peakHeap: number;
  readonly deferredResetFrames: conversationViewModuleTypes.DeltaFrame[] = [];

  readonly args: conversationViewModuleTypes.WorkerArguments;

  constructor(args: conversationViewModuleTypes.WorkerArguments) {
    this.args = args;
    for (let index = 0; index < args.headlineEntries; index++) {
      const entry = makeEntry({
        id: this.nextEntryId++,
        kind: entryKindAt(index),
        parent: this.head,
      });
      this.records.set(entry.id, entry);
      this.head = entry.id;
    }
    const documents = Object.entries(initialDocuments()) as Array<
      [conversationViewModuleTypes.DocumentKey, conversationViewModuleTypes.JsonObject]
    >;
    this.documentTrackers = Object.fromEntries(
      documents.map(([key, value]) => [key, createTracker(value)]),
    ) as Record<
      conversationViewModuleTypes.DocumentKey,
      conversationViewModuleTypes.TrackerLike<conversationViewModuleTypes.JsonObject>
    >;
    this.aggregate = this.rebuildExpectedView();
    this.initialAggregateBytes = Buffer.byteLength(JSON.stringify(this.aggregate));
    this.documentSequences = Object.fromEntries(documents.map(([key]) => [key, 0])) as Record<
      conversationViewModuleTypes.DocumentKey,
      number
    >;
    this.peakHeap = process.memoryUsage().heapUsed;
  }

  rebuildExpectedView(): conversationViewModuleTypes.ConversationView {
    const docs = {} as Record<
      conversationViewModuleTypes.MountedKey,
      conversationViewModuleTypes.JsonObject
    >;
    for (const key of MOUNTED_KEYS) docs[key] = cloneTrusted(this.documentTrackers[key].value);
    return {
      conversation: { head: this.head, id: "conversation-1" },
      docs,
      entries: cloneTrusted(resolveActiveLineage(this.records, this.head)),
      schema: PROVISIONAL_SCHEMA,
    };
  }

  samplePeak(): void {
    this.peakHeap = Math.max(this.peakHeap, process.memoryUsage().heapUsed);
  }

  clearWatchQueue<T extends object>(watch: conversationViewModuleTypes.Watch<T>): void {
    this.queuedFrameReferences -= watch.queue.length;
    this.queuedOperationReferences -= watch.pendingOperationCount;
    for (const frame of watch.queue) {
      const references = this.queuedFrameRefCounts.get(frame)! - 1;
      if (references === 0) this.queuedFrameRefCounts.delete(frame);
      else this.queuedFrameRefCounts.set(frame, references);
    }
    watch.queue.length = 0;
    watch.pendingOperationCount = 0;
  }

  retainQueuedFrame<T extends object>(
    watch: conversationViewModuleTypes.Watch<T>,
    frame: conversationViewModuleTypes.DeltaFrame,
  ): void {
    watch.queue.push(frame);
    watch.pendingOperationCount += frame.ops.length;
    this.queuedFrameReferences += 1;
    this.queuedOperationReferences += frame.ops.length;
    this.queuedFrameRefCounts.set(frame, (this.queuedFrameRefCounts.get(frame) ?? 0) + 1);
  }

  resetWatch<T extends object>(
    watch: conversationViewModuleTypes.Watch<T>,
    value: T,
    sequence: number,
  ): void {
    this.clearWatchQueue(watch);
    const cloneStart = performance.now();
    const resetValue = value;
    this.phaseSamples.resetClone.push(performance.now() - cloneStart);
    const frame: conversationViewModuleTypes.DeltaFrame = {
      kind: "delta",
      ops: [["r", resetValue as unknown as JsonValue]],
      sequence,
    };
    this.retainQueuedFrame(watch, frame);
    this.deferredResetFrames.push(frame);
    this.resetCount += 1;
  }

  enqueueWatch<T extends object>(
    watch: conversationViewModuleTypes.Watch<T>,
    frame: conversationViewModuleTypes.DeltaFrame,
    current: T,
  ): void {
    const previous = watch.queue.at(-1)?.sequence ?? watch.deliveredSequence;
    assert.equal(frame.sequence, previous + 1);
    const capacity = this.args.config.queueCapacity;
    if (capacity !== undefined && watch.pendingOperationCount + frame.ops.length > capacity) {
      this.resetWatch(watch, current, frame.sequence);
      return;
    }
    this.retainQueuedFrame(watch, frame);
  }

  sampleQueueMetrics(): void {
    this.peakQueueReferences = Math.max(this.peakQueueReferences, this.queuedFrameReferences);
    this.peakQueuedOperationReferences = Math.max(
      this.peakQueuedOperationReferences,
      this.queuedOperationReferences,
    );
    this.peakUniqueQueuedBatches = Math.max(
      this.peakUniqueQueuedBatches,
      this.queuedFrameRefCounts.size,
    );
    this.samplePendingOperations(this.conversationWatches);
    this.samplePendingOperations(this.documentWatches);
  }

  samplePendingOperations<T extends object>(
    watches: readonly conversationViewModuleTypes.Watch<T>[],
  ): void {
    for (const watch of watches) {
      this.peakPendingOperationsPerWatch = Math.max(
        this.peakPendingOperationsPerWatch,
        watch.pendingOperationCount,
      );
    }
  }
}

export default ConversationViewState;
