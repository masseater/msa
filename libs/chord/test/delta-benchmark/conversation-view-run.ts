import assert from "node:assert/strict";

import { Effect } from "effect";

import conversationViewContent from "./conversation-view-content.ts";
import conversationViewModel from "./conversation-view-model.ts";
import type conversationViewModelTypes from "./conversation-view-model.types.ts";
import type conversationViewRunTypes from "./conversation-view-run.types.ts";
import ConversationViewSession from "./conversation-view-session.ts";
import conversationViewTypes from "./conversation-view-types.ts";
import type conversationViewModuleTypes from "./conversation-view-types.types.ts";

const { distribution } = conversationViewContent;
const { PROVISIONAL_SCHEMA } = conversationViewModel;
const { MOUNTED_KEYS } = conversationViewTypes;

const sumOf = <T extends object>(
  watches: readonly conversationViewModuleTypes.Watch<T>[],
  count: (watch: conversationViewModuleTypes.Watch<T>) => number,
): number => watches.reduce((total, watch) => total + count(watch), 0);

class ConversationViewRun extends ConversationViewSession {
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

  finalQueues(): conversationViewRunTypes.FinalQueues {
    const queueLength = (watch: conversationViewModuleTypes.Watch<object>) => watch.queue.length;
    const pending = (watch: conversationViewModuleTypes.Watch<object>) =>
      watch.pendingOperationCount;
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

  phaseDistributions(): Record<
    conversationViewModelTypes.PhaseName,
    conversationViewModelTypes.Distribution
  > {
    return Object.fromEntries(
      (Object.keys(this.phaseSamples) as conversationViewModelTypes.PhaseName[]).map((name) => [
        name,
        distribution(this.phaseSamples[name]),
      ]),
    ) as Record<conversationViewModelTypes.PhaseName, conversationViewModelTypes.Distribution>;
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
      commitTarget,
      conversationWatchCount: config.conversationWatchCount,
      deliveryModel: "async-serialized-ops-only-no-consumer-apply",
      documentWatchCount: config.documentWatchCount,
      headlineEntries,
      initialAggregateBytes: this.initialAggregateBytes,
      mode,
      provisionalSchema: PROVISIONAL_SCHEMA,
      queueCapacity: config.queueCapacity ?? null,
      queueCapacityUnit: "pending-operations",
      scenario,
      trial,
    } as const;
  }

  counters(final: conversationViewRunTypes.FinalQueues) {
    return {
      aggregateOperationBytes: this.aggregateOperationBytes,
      aggregateOperationCount: this.aggregateOperationCount,
      conversationBaseBytes: this.conversationBaseBytes,
      conversationRegistrations: this.conversationRegistrations,
      conversationSequence: this.conversationSequence,
      deliveryFrameReferences: this.deliveryFrameReferences,
      deliveryOperationReferences: this.deliveryOperationReferences,
      documentBaseBytes: this.documentBaseBytes,
      documentOperationBytes: this.documentOperationBytes,
      documentOperationCount: this.documentOperationCount,
      documentRegistrations: this.documentRegistrations,
      documentSequences: this.documentSequences,
      noOpCommitCount: this.noOpCommitCount,
      peakPendingOperationsPerWatch: this.peakPendingOperationsPerWatch,
      peakQueueReferences: this.peakQueueReferences,
      peakQueuedOperationReferences: this.peakQueuedOperationReferences,
      peakUniqueQueuedBatches: this.peakUniqueQueuedBatches,
      publishedAggregateBatches: this.publishedAggregateBatches,
      publishedDocumentBatches: this.publishedDocumentBatches,
      resetBytes: this.resetBytes,
      resetCount: this.resetCount,
      unmountedCommitCount: this.unmountedCommitCount,
      ...final,
      phaseDistributions: this.phaseDistributions(),
    };
  }
}

export default ConversationViewRun;
