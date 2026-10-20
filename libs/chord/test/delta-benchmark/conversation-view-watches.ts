import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { Effect } from "effect";

import { applyImmutable } from "../../src/delta/index.ts";
import { sha256Hex } from "../../src/platform.ts";
import benchmarkWorkerModel from "./benchmark-worker-model.ts";
import ConversationViewState from "./conversation-view-state.ts";
import conversationViewTypes from "./conversation-view-types.ts";
import type conversationViewModuleTypes from "./conversation-view-types.types.ts";

const { cloneTrusted } = benchmarkWorkerModel;
const { DOCUMENT_WATCH_KEYS } = conversationViewTypes;

const snapshotText = (value: object): string => JSON.stringify(value);

const isResetJump = (
  frame: conversationViewModuleTypes.DeltaFrame,
  previousSequence: number,
): boolean =>
  frame.sequence > previousSequence + 1 && frame.ops.length === 1 && frame.ops[0]![0] === "r";

class ConversationViewWatches extends ConversationViewState {
  serializeBaseSnapshot(
    watchType: conversationViewModuleTypes.WatchType,
    snapshot: object,
  ): string {
    const phase = watchType === "conversation" ? "conversationSerialize" : "documentSerialize";
    const start = performance.now();
    const encoded = snapshotText(snapshot);
    this.phaseSamples[phase].push(performance.now() - start);
    const bytes = Buffer.byteLength(encoded);
    if (watchType === "conversation") this.conversationBaseBytes += bytes;
    else this.documentBaseBytes += bytes;
    return encoded;
  }

  captureSnapshot<T extends object>(value: T, phase: "conversationAcquire" | "documentAcquire"): T {
    const start = performance.now();
    const snapshot = value;
    this.phaseSamples[phase].push(performance.now() - start);
    this.samplePeak();
    return snapshot;
  }

  createWatch<T extends object>(
    value: T,
    sequence: number,
    started: boolean,
    watchType: conversationViewModuleTypes.WatchType,
  ): Effect.Effect<conversationViewModuleTypes.Watch<T>> {
    return Effect.gen({ self: this }, function* () {
      const phase = watchType === "conversation" ? "conversationAcquire" : "documentAcquire";
      const snapshot = this.captureSnapshot(value, phase);
      if (watchType === "conversation") this.conversationRegistrations += 1;
      else this.documentRegistrations += 1;
      const baseHash = yield* sha256Hex(this.serializeBaseSnapshot(watchType, snapshot));
      return {
        baseHash,
        baseSequence: sequence,
        deliveredSequence: sequence,
        pendingOperationCount: 0,
        queue: [],
        snapshot,
        started,
        watchType,
      };
    });
  }

  registerConversationWatch(started: boolean): Effect.Effect<void> {
    return Effect.map(
      this.createWatch(this.aggregate, this.conversationSequence, started, "conversation"),
      (watch) => {
        this.conversationWatches.push(watch);
      },
    );
  }

  registerDocumentWatch(
    key: conversationViewModuleTypes.DocumentKey,
    started: boolean,
  ): Effect.Effect<void> {
    const value = this.documentTrackers[key].value;
    return Effect.map(
      this.createWatch(value, this.documentSequences[key], started, "document"),
      (watch) => {
        this.documentWatches.push({ ...watch, key });
      },
    );
  }

  acquireInitialWatches(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const { conversationWatchCount, documentWatchCount, started } = this.args.config;
      for (let index = 0; index < conversationWatchCount; index++)
        yield* this.registerConversationWatch(started);
      for (let index = 0; index < documentWatchCount; index++)
        yield* this.registerDocumentWatch(
          DOCUMENT_WATCH_KEYS[index % DOCUMENT_WATCH_KEYS.length]!,
          started,
        );
    });
  }

  verifySnapshotUnchanged<T extends object>(
    watch: conversationViewModuleTypes.Watch<T>,
  ): Effect.Effect<void> {
    return Effect.map(sha256Hex(snapshotText(watch.snapshot)), (hash) => {
      assert.equal(hash, watch.baseHash);
    });
  }

  verifyAndDropConversationWatch(
    watch: conversationViewModuleTypes.Watch<conversationViewModuleTypes.ConversationView>,
  ): Effect.Effect<void> {
    return Effect.map(this.verifySnapshotUnchanged(watch), () => {
      if (watch.started) assert.equal(watch.deliveredSequence, this.conversationSequence);
      this.conversationWatches = this.conversationWatches.filter((other) => other !== watch);
    });
  }

  verifyAndDropDocumentWatch(
    watch: conversationViewModuleTypes.DocumentWatch,
  ): Effect.Effect<void> {
    return Effect.map(this.verifySnapshotUnchanged(watch), () => {
      if (watch.started) assert.equal(watch.deliveredSequence, this.documentSequences[watch.key]);
      this.documentWatches = this.documentWatches.filter((other) => other !== watch);
    });
  }

  reconnect(index: number): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const churnInterval = Math.max(8, Math.floor(this.args.commitTarget / 10));
      if (this.args.scenario !== "churn-reconnect" || (index + 1) % churnInterval !== 0) return;
      const current = this.conversationWatches[0];
      if (current !== undefined) yield* this.verifyAndDropConversationWatch(current);
      yield* this.registerConversationWatch(true);
      const keyIndex = Math.floor((index + 1) / churnInterval) % DOCUMENT_WATCH_KEYS.length;
      const key = DOCUMENT_WATCH_KEYS[keyIndex]!;
      const currentDocument = this.documentWatches.find((watch) => watch.key === key);
      if (currentDocument !== undefined) yield* this.verifyAndDropDocumentWatch(currentDocument);
      yield* this.registerDocumentWatch(key, true);
    });
  }

  replayWatch<T extends object>(
    watch: conversationViewModuleTypes.Watch<T>,
    expected: T,
    expectedSequence: number,
  ): Effect.Effect<void> {
    return Effect.map(this.verifySnapshotUnchanged(watch), () => {
      if (watch.started) {
        assert.equal(watch.deliveredSequence, expectedSequence);
        return;
      }
      let value = cloneTrusted(watch.snapshot);
      let sequence = watch.baseSequence;
      for (const frame of watch.queue) {
        assert.ok(frame.sequence === sequence + 1 || isResetJump(frame, sequence));
        value = applyImmutable(value, frame.ops);
        sequence = frame.sequence;
      }
      assert.equal(sequence, expectedSequence);
      assert.deepEqual(value, expected);
    });
  }

  forwardOpsOnly(frame: conversationViewModuleTypes.DeltaFrame): Effect.Effect<void> {
    return Effect.map(
      Effect.promise(() => Promise.resolve()),
      () => {
        this.deliveryFrameReferences += 1;
        this.deliveryOperationReferences += frame.ops.length;
      },
    );
  }

  drainWatch<T extends object>(
    watch: conversationViewModuleTypes.Watch<T>,
    expectedSequence: number,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!watch.started) return;
      for (const frame of watch.queue) {
        assert.ok(
          frame.sequence === watch.deliveredSequence + 1 ||
            isResetJump(frame, watch.deliveredSequence),
        );
        yield* this.forwardOpsOnly(frame);
        watch.deliveredSequence = frame.sequence;
      }
      this.clearWatchQueue(watch);
      assert.equal(watch.deliveredSequence, expectedSequence);
    });
  }

  drainStartedWatches(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const start = performance.now();
      for (const watch of this.conversationWatches)
        yield* this.drainWatch(watch, this.conversationSequence);
      for (const watch of this.documentWatches)
        yield* this.drainWatch(watch, this.documentSequences[watch.key]);
      this.phaseSamples.delivery.push(performance.now() - start);
    });
  }
}

export default ConversationViewWatches;
