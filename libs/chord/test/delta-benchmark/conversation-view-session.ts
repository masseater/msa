import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { Effect } from "effect";

import { type JsonValue, type Op, applyImmutable } from "../../src/delta/index.ts";
import benchmarkWorkerModel from "./benchmark-worker-model.ts";
import conversationViewContent from "./conversation-view-content.ts";
import planCommit from "./conversation-view-plan.ts";
import type conversationViewTypes from "./conversation-view-types.types.ts";
import ConversationViewWatches from "./conversation-view-watches.ts";

const { cloneTrusted } = benchmarkWorkerModel;
const { commonEntryPrefix, makeEntry, prefixDocumentOperations, resolveActiveLineage } =
  conversationViewContent;

type Pending = {
  readonly key: conversationViewTypes.DocumentKey;
  readonly change: conversationViewTypes.ChangeLike<conversationViewTypes.JsonObject>;
};
type PreparedChange = Pending & {
  readonly prepared: conversationViewTypes.PreparedLike<conversationViewTypes.JsonObject>;
};
type Publication = {
  readonly aggregateFrame: conversationViewTypes.DeltaFrame | undefined;
  readonly documentFrames: readonly conversationViewTypes.DocumentWatchFrame[];
};

class ConversationViewSession extends ConversationViewWatches {
  queuedConversationFrames(): number {
    return this.conversationWatches.reduce((total, watch) => total + watch.queue.length, 0);
  }

  mutate(plan: conversationViewTypes.CommitPlan): Pending[] {
    const start = performance.now();
    const pending: Pending[] = [];
    for (const mutation of plan.docs) {
      const change = this.documentTrackers[mutation.key].beginChange();
      mutation.mutate(change.state);
      pending.push({ change, key: mutation.key });
    }
    if (plan.entryKind !== undefined) {
      let parent = this.head;
      if (plan.branch === true) {
        const active = resolveActiveLineage(this.records, this.head);
        parent = active[Math.max(0, active.length - 48)]?.id ?? null;
      }
      const entry = makeEntry({ id: this.nextEntryId++, kind: plan.entryKind, parent });
      this.records.set(entry.id, entry);
      this.head = entry.id;
    }
    this.phaseSamples.mutation.push(performance.now() - start);
    return pending;
  }

  prepareAndAdopt(pending: readonly Pending[]): PreparedChange[] {
    const prepareStart = performance.now();
    const prepared = pending.map(({ key, change }) => ({
      change,
      key,
      prepared: change.prepare(),
    }));
    this.phaseSamples.prepare.push(performance.now() - prepareStart);
    const adoptStart = performance.now();
    for (const item of prepared) this.documentTrackers[item.key].adopt(item.prepared);
    this.phaseSamples.adopt.push(performance.now() - adoptStart);
    return prepared;
  }

  documentFrames(
    prepared: readonly PreparedChange[],
    aggregateOps: Op[],
  ): conversationViewTypes.DocumentWatchFrame[] {
    const frames: conversationViewTypes.DocumentWatchFrame[] = [];
    for (const item of prepared) {
      if (item.prepared.ops.length === 0) continue;
      this.documentSequences[item.key] += 1;
      const documentOps = item.prepared.ops;
      this.documentOperationCount += documentOps.length;
      this.publishedDocumentBatches += 1;
      frames.push({
        frame: { kind: "delta", ops: documentOps, sequence: this.documentSequences[item.key] },
        key: item.key,
      });
      if (item.key !== "audit")
        aggregateOps.push(...prefixDocumentOperations(item.key, documentOps));
    }
    return frames;
  }

  entryOperations(aggregateOps: Op[]): void {
    const previousEntries = this.aggregate.entries;
    const nextEntries = resolveActiveLineage(this.records, this.head);
    const common = commonEntryPrefix(previousEntries, nextEntries);
    if (common === previousEntries.length && common === nextEntries.length) return;
    aggregateOps.push([
      "p",
      ["entries"],
      common,
      previousEntries.length - common,
      cloneTrusted(nextEntries.slice(common)) as unknown as JsonValue[],
    ]);
    aggregateOps.push(["s", ["conversation", "head"], this.head]);
  }

  synthesize(
    plan: conversationViewTypes.CommitPlan,
    prepared: readonly PreparedChange[],
  ): Publication {
    const start = performance.now();
    const aggregateOps: Op[] = [];
    const documentFrames = this.documentFrames(prepared, aggregateOps);
    if (plan.entryKind !== undefined) this.entryOperations(aggregateOps);
    let aggregateFrame: conversationViewTypes.DeltaFrame | undefined;
    if (aggregateOps.length > 0) {
      this.conversationSequence += 1;
      this.aggregateOperationCount += aggregateOps.length;
      this.publishedAggregateBatches += 1;
      aggregateFrame = { kind: "delta", ops: aggregateOps, sequence: this.conversationSequence };
    }
    this.phaseSamples.synthesize.push(performance.now() - start);
    return { aggregateFrame, documentFrames };
  }

  project(
    plan: conversationViewTypes.CommitPlan,
    prepared: readonly PreparedChange[],
  ): Publication {
    const projectStart = performance.now();
    const publication = this.synthesize(plan, prepared);
    const applyStart = performance.now();
    if (publication.aggregateFrame !== undefined)
      this.aggregate = applyImmutable(this.aggregate, publication.aggregateFrame.ops);
    this.phaseSamples.projectApply.push(performance.now() - applyStart);
    this.phaseSamples.project.push(performance.now() - projectStart);
    return publication;
  }

  enqueuePublishedBatches({ aggregateFrame, documentFrames }: Publication): void {
    const start = performance.now();
    if (aggregateFrame !== undefined) {
      for (const watch of this.conversationWatches)
        this.enqueueWatch(watch, aggregateFrame, this.aggregate);
    }
    for (const documentFrame of documentFrames) {
      for (const watch of this.documentWatches) {
        if (watch.key === documentFrame.key)
          this.enqueueWatch(watch, documentFrame.frame, this.documentTrackers[watch.key].value);
      }
    }
    this.sampleQueueMetrics();
    this.phaseSamples.enqueue.push(performance.now() - start);
  }

  serializePublishedBatches({ aggregateFrame, documentFrames }: Publication): void {
    const start = performance.now();
    if (aggregateFrame !== undefined)
      this.aggregateOperationBytes += Buffer.byteLength(JSON.stringify(aggregateFrame.ops));
    for (const { frame } of documentFrames)
      this.documentOperationBytes += Buffer.byteLength(JSON.stringify(frame.ops));
    this.phaseSamples.opSerialize.push(performance.now() - start);
  }

  finishResetSerialization(): void {
    if (this.deferredResetFrames.length === 0) return;
    const start = performance.now();
    for (const frame of this.deferredResetFrames)
      this.resetBytes += Buffer.byteLength(JSON.stringify(frame.ops));
    this.phaseSamples.resetSerialize.push(performance.now() - start);
    this.deferredResetFrames.length = 0;
  }

  publish(plan: conversationViewTypes.CommitPlan): Publication {
    const sessionStart = performance.now();
    const prepared = this.prepareAndAdopt(this.mutate(plan));
    const publication = this.project(plan, prepared);
    this.enqueuePublishedBatches(publication);
    this.phaseSamples.sessionLine.push(performance.now() - sessionStart);
    this.sessionCommitCount += 1;
    this.samplePeak();
    this.serializePublishedBatches(publication);
    this.finishResetSerialization();
    return publication;
  }

  checkCommit(
    plan: conversationViewTypes.CommitPlan,
    publication: Publication,
    before: readonly [number, number],
  ): void {
    if (plan.expectedConversationNoop) {
      this.noOpCommitCount += 1;
      assert.equal(publication.aggregateFrame, undefined);
    }
    if (!plan.unmountedOnly) return;
    this.unmountedCommitCount += 1;
    const [conversationBefore, queuedBefore] = before;
    if (
      this.conversationSequence !== conversationBefore ||
      this.queuedConversationFrames() !== queuedBefore
    )
      this.unmountedPublicationViolations += 1;
  }

  commit(index: number): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const plan = planCommit({ index, scenario: this.args.scenario });
      const before = [this.conversationSequence, this.queuedConversationFrames()] as const;
      const publication = this.publish(plan);
      yield* this.drainStartedWatches();
      this.samplePeak();
      this.checkCommit(plan, publication, before);
    });
  }
}

export default ConversationViewSession;
