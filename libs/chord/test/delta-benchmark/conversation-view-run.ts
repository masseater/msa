import assert from "node:assert/strict";

import { Effect } from "effect";

import { distribution } from "./conversation-view-content.ts";
import {
  type Distribution,
  type PhaseName,
  PROVISIONAL_SCHEMA,
} from "./conversation-view-model.ts";
import { ConversationViewSession } from "./conversation-view-session.ts";
import { MOUNTED_KEYS, type Watch } from "./conversation-view-types.ts";

export interface FinalQueues {
  readonly finalQueueReferences: number;
  readonly finalQueuedOperationReferences: number;
  readonly finalUniqueQueuedBatches: number;
}

const sumOf = <T extends object>(
  watches: readonly Watch<T>[],
  count: (watch: Watch<T>) => number,
): number => watches.reduce((total, watch) => total + count(watch), 0);

export class ConversationViewRun extends ConversationViewSession {
  verify(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      assert.deepEqual(this.aggregate, this.rebuildExpectedView());
      for (const watch of this.conversationWatches)
        yield* this.replayWatch(watch, this.aggregate, this.conversationSequence);
      for (const watch of this.documentWatches) {
        const expected = this.documentTrackers[watch.key].value;
        yield* this.replayWatch(watch, expected, this.documentSequences[watch.key]);
      }
      const { commitTarget } = this.args;
      assert.equal(this.unmountedPublicationViolations, 0);
      assert.equal(this.noOpCommitCount, Math.floor(commitTarget / 100));
      assert.equal(this.unmountedCommitCount, Math.floor(commitTarget / 100));
      assert.equal(this.sessionCommitCount, commitTarget);
    });
  }

  finalQueues(): FinalQueues {
    const queueLength = (watch: Watch<object>) => watch.queue.length;
    const pending = (watch: Watch<object>) => watch.pendingOperationCount;
    const final = {
      finalQueueReferences:
        sumOf(this.conversationWatches, queueLength) + sumOf(this.documentWatches, queueLength),
      finalQueuedOperationReferences:
        sumOf(this.conversationWatches, pending) + sumOf(this.documentWatches, pending),
      finalUniqueQueuedBatches: new Set([
        ...this.conversationWatches.flatMap((watch) => watch.queue),
        ...this.documentWatches.flatMap((watch) => watch.queue),
      ]).size,
    };
    assert.equal(final.finalQueueReferences, this.queuedFrameReferences);
    assert.equal(final.finalQueuedOperationReferences, this.queuedOperationReferences);
    assert.equal(final.finalUniqueQueuedBatches, this.queuedFrameRefCounts.size);
    assert.equal(this.deferredResetFrames.length, 0);
    return final;
  }

  releaseQueues(): void {
    for (const watch of this.conversationWatches) this.clearWatchQueue(watch);
    for (const watch of this.documentWatches) this.clearWatchQueue(watch);
    this.conversationWatches = [];
    this.documentWatches = [];
    assert.equal(this.queuedFrameReferences, 0);
    assert.equal(this.queuedOperationReferences, 0);
    assert.equal(this.queuedFrameRefCounts.size, 0);
  }

  phaseDistributions(): Record<PhaseName, Distribution> {
    return Object.fromEntries(
      (Object.keys(this.phaseSamples) as PhaseName[]).map((name) => [
        name,
        distribution(this.phaseSamples[name]),
      ]),
    ) as Record<PhaseName, Distribution>;
  }

  checksum(): number {
    const { aggregate } = this;
    return (
      aggregate.entries.length +
      Number(aggregate.conversation.head ?? 0) +
      this.conversationSequence +
      MOUNTED_KEYS.reduce((total, key) => total + JSON.stringify(aggregate.docs[key]).length, 0)
    );
  }

  identity() {
    const { mode, scenario, trial, headlineEntries, commitTarget, config } = this.args;
    return {
      mode,
      scenario,
      trial,
      provisionalSchema: PROVISIONAL_SCHEMA,
      headlineEntries,
      commitTarget,
      initialAggregateBytes: this.initialAggregateBytes,
      conversationWatchCount: config.conversationWatchCount,
      documentWatchCount: config.documentWatchCount,
      queueCapacity: config.queueCapacity ?? null,
      queueCapacityUnit: "pending-operations",
      deliveryModel: "async-serialized-ops-only-no-consumer-apply",
    } as const;
  }

  counters(final: FinalQueues) {
    return {
      conversationSequence: this.conversationSequence,
      documentSequences: this.documentSequences,
      publishedAggregateBatches: this.publishedAggregateBatches,
      publishedDocumentBatches: this.publishedDocumentBatches,
      conversationRegistrations: this.conversationRegistrations,
      documentRegistrations: this.documentRegistrations,
      conversationBaseBytes: this.conversationBaseBytes,
      documentBaseBytes: this.documentBaseBytes,
      noOpCommitCount: this.noOpCommitCount,
      unmountedCommitCount: this.unmountedCommitCount,
      resetCount: this.resetCount,
      resetBytes: this.resetBytes,
      deliveryFrameReferences: this.deliveryFrameReferences,
      deliveryOperationReferences: this.deliveryOperationReferences,
      aggregateOperationCount: this.aggregateOperationCount,
      aggregateOperationBytes: this.aggregateOperationBytes,
      documentOperationCount: this.documentOperationCount,
      documentOperationBytes: this.documentOperationBytes,
      peakQueueReferences: this.peakQueueReferences,
      peakQueuedOperationReferences: this.peakQueuedOperationReferences,
      peakPendingOperationsPerWatch: this.peakPendingOperationsPerWatch,
      peakUniqueQueuedBatches: this.peakUniqueQueuedBatches,
      ...final,
      phaseDistributions: this.phaseDistributions(),
    };
  }
}
