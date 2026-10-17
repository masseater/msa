import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import type { JsonValue } from "../../src/delta/index.ts";
import { cloneTrusted } from "./benchmark-worker-model.ts";
import {
  createTracker,
  entryKindAt,
  makeEntry,
  resolveActiveLineage,
} from "./conversation-view-content.ts";
import { initialDocuments } from "./conversation-view-documents.ts";
import { type PhaseName, phaseNames, PROVISIONAL_SCHEMA } from "./conversation-view-model.ts";
import {
  type ConversationView,
  type DeltaFrame,
  type DocumentKey,
  type DocumentWatch,
  type JsonObject,
  MOUNTED_KEYS,
  type MountedKey,
  type PhaseSamples,
  type TrackerLike,
  type TranscriptEntry,
  type Watch,
  type WorkerArguments,
} from "./conversation-view-types.ts";

const emptySamples = (): PhaseSamples =>
  Object.fromEntries(phaseNames.map((name): [PhaseName, number[]] => [name, []])) as PhaseSamples;

export class ConversationViewState {
  readonly phaseSamples = emptySamples();
  readonly records = new Map<number, TranscriptEntry>();
  head: number | null = null;
  nextEntryId = 1;
  readonly documentTrackers: Record<DocumentKey, TrackerLike<JsonObject>>;
  aggregate: ConversationView;
  readonly initialAggregateBytes: number;
  conversationSequence = 0;
  readonly documentSequences: Record<DocumentKey, number>;
  conversationWatches: Array<Watch<ConversationView>> = [];
  documentWatches: DocumentWatch[] = [];
  queuedFrameReferences = 0;
  queuedOperationReferences = 0;
  readonly queuedFrameRefCounts = new Map<DeltaFrame, number>();
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
  readonly deferredResetFrames: DeltaFrame[] = [];

  readonly args: WorkerArguments;

  constructor(args: WorkerArguments) {
    this.args = args;
    for (let index = 0; index < args.headlineEntries; index++) {
      const entry = makeEntry({
        id: this.nextEntryId++,
        parent: this.head,
        kind: entryKindAt(index),
      });
      this.records.set(entry.id, entry);
      this.head = entry.id;
    }
    const documents = Object.entries(initialDocuments()) as Array<[DocumentKey, JsonObject]>;
    this.documentTrackers = Object.fromEntries(
      documents.map(([key, value]) => [key, createTracker(value)]),
    ) as Record<DocumentKey, TrackerLike<JsonObject>>;
    this.aggregate = this.rebuildExpectedView();
    this.initialAggregateBytes = Buffer.byteLength(JSON.stringify(this.aggregate));
    this.documentSequences = Object.fromEntries(documents.map(([key]) => [key, 0])) as Record<
      DocumentKey,
      number
    >;
    this.peakHeap = process.memoryUsage().heapUsed;
  }

  rebuildExpectedView(): ConversationView {
    const docs = {} as Record<MountedKey, JsonObject>;
    for (const key of MOUNTED_KEYS) docs[key] = cloneTrusted(this.documentTrackers[key].value);
    return {
      schema: PROVISIONAL_SCHEMA,
      conversation: { id: "conversation-1", head: this.head },
      docs,
      entries: cloneTrusted(resolveActiveLineage(this.records, this.head)),
    };
  }

  samplePeak(): void {
    this.peakHeap = Math.max(this.peakHeap, process.memoryUsage().heapUsed);
  }

  clearWatchQueue<T extends object>(watch: Watch<T>): void {
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

  retainQueuedFrame<T extends object>(watch: Watch<T>, frame: DeltaFrame): void {
    watch.queue.push(frame);
    watch.pendingOperationCount += frame.ops.length;
    this.queuedFrameReferences += 1;
    this.queuedOperationReferences += frame.ops.length;
    this.queuedFrameRefCounts.set(frame, (this.queuedFrameRefCounts.get(frame) ?? 0) + 1);
  }

  resetWatch<T extends object>(watch: Watch<T>, value: T, sequence: number): void {
    this.clearWatchQueue(watch);
    const cloneStart = performance.now();
    const resetValue = value;
    this.phaseSamples.resetClone.push(performance.now() - cloneStart);
    const frame: DeltaFrame = {
      kind: "delta",
      sequence,
      ops: [["r", resetValue as unknown as JsonValue]],
    };
    this.retainQueuedFrame(watch, frame);
    this.deferredResetFrames.push(frame);
    this.resetCount += 1;
  }

  enqueueWatch<T extends object>(watch: Watch<T>, frame: DeltaFrame, current: T): void {
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

  samplePendingOperations<T extends object>(watches: readonly Watch<T>[]): void {
    for (const watch of watches) {
      this.peakPendingOperationsPerWatch = Math.max(
        this.peakPendingOperationsPerWatch,
        watch.pendingOperationCount,
      );
    }
  }
}
