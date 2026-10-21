import type portableTypes from "@msa/codemode/portable.types";
import { Cause, Effect, Exit } from "effect";

import callRows from "./call-outcome.ts";
import journalCalls from "./journal-calls.ts";
import runCalls from "./run-calls.ts";
import runDocs from "./run-docs.ts";
import type runDocsTypes from "./run-docs.types.ts";
import type runJournalTypes from "./run-journal.types.ts";
import runPersist from "./run-persist.ts";

const { appendJournal, recordFingerprint } = runPersist;
const { errorResult } = runDocs;
const { asToolCall, describeCall, failedCall, sameJson } = callRows;
const { callTool } = runCalls;
const { priorCall, settleCall } = journalCalls;

export default class RunJournal {
  private readonly control: runJournalTypes.RunControl;
  private readonly gate = Promise.withResolvers<void>();
  private readonly ready = new Map<number, portableTypes.CodemodeOutcome>();
  private readonly acks = new Map<number, number>();
  private readonly replayIndex: Map<number, number>;
  private journalLength: number;
  private nextReplayed = 0;
  private replaying: boolean;
  private released = false;
  private durableIssued: number;
  private issued = 0;
  private waiting: portableTypes.CodemodeHostCall[] = [];
  private held: portableTypes.CodemodeHostCall[] = [];
  private queue: runDocsTypes.Settled[] = [];
  private committing = false;

  constructor(control: runJournalTypes.RunControl) {
    const { journal, firstIssued } = control.opened;
    this.control = control;
    this.replayIndex = new Map(journal.map((entry, index) => [entry.id, index]));
    this.journalLength = journal.length;
    this.replaying = journal.length > 0;
    this.durableIssued = journal.reduce(
      (max, entry) => Math.max(max, entry.issuedAfter ?? 0),
      firstIssued ?? 0,
    );
  }

  private get replayed(): runDocsTypes.JournalEntry[] {
    return this.control.opened.journal;
  }

  private get stopped(): boolean {
    return this.control.stopped();
  }

  checkFingerprint(fingerprint: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const { control } = this;
      const recorded = control.opened.start.fingerprint;
      if (recorded === undefined) {
        const saved = yield* Effect.exit(recordFingerprint(control.host, fingerprint));
        if (Exit.isFailure(saved)) {
          control.fail(Cause.squash(saved.cause));
          return;
        }
      } else if (recorded !== fingerprint) {
        yield* control.refuse(
          errorResult(
            `The script cannot resume: the sandbox changed since it started (${recorded} -> ${fingerprint}).`,
          ),
          new Error("Sandbox fingerprint changed"),
        );
        return;
      }
      this.gate.resolve();
      if (this.replaying) this.deliverReplayed();
      else if (!control.opened.rerun) yield* this.release();
    });
  }

  onCall(made: portableTypes.CodemodeHostCall): void {
    if (this.stopped) return;
    const call = asToolCall(made);
    if (call.target === "tool") this.control.host.rows.started(call);
    this.issued = Math.max(this.issued, call.id);
    const index = this.replaying ? (this.replayIndex.get(call.id) ?? -1) : -1;
    if (index !== -1) {
      this.replayCall(call, this.replayed[index]!);
      return;
    }
    if (this.released) {
      this.waiting.push(call);
      this.launchCovered();
    } else this.held.push(call);
  }

  private replayCall(call: portableTypes.CodemodeHostCall, entry: runDocsTypes.JournalEntry): void {
    const { global } = entry;
    if (global !== undefined) {
      if (
        call.target !== "global" ||
        call.name !== global.name ||
        !sameJson(call.args, global.args)
      ) {
        this.control.diverge(
          `call ${call.id} is ${describeCall(call)}, but was a call to ${global.name}`,
        );
        return;
      }
      this.ready.set(call.id, global.outcome as portableTypes.CodemodeOutcome);
      void this.gate.promise.then(() => this.deliverReplayed());
      return;
    }
    if (call.target !== "tool") {
      this.control.diverge(`call ${call.id} is ${describeCall(call)}, but was a tool call`);
      return;
    }
    void this.gate.promise
      .then(() => Effect.runPromise(callTool(this.control.host, call)))
      .then(
        (outcome) => this.replayedOutcome(call.id, outcome),
        (error: unknown) => this.callFailed(call, error),
      );
  }

  private replayedOutcome(id: number, outcome: portableTypes.CodemodeOutcome): void {
    this.ready.set(id, outcome);
    this.deliverReplayed();
  }

  private callFailed(call: portableTypes.CodemodeHostCall, error: unknown): void {
    if (this.stopped) return;
    if (this.control.host.context.abortSignal?.aborted === true) this.control.fail(error);
    else this.control.diverge(failedCall(call, error));
  }

  private deliverReplayed(): void {
    while (this.nextReplayed < this.replayed.length && !this.stopped) {
      const entry = this.replayed[this.nextReplayed]!;
      const outcome = this.ready.get(entry.id);
      if (entry.id > this.issued || outcome === undefined) return;
      this.ready.delete(entry.id);
      this.nextReplayed++;
      this.control.run().deliver(this.nextReplayed, entry.at, entry.id, outcome);
    }
  }

  private issuedDiffers(seq: number, issued: number): boolean {
    const { opened } = this.control;
    if (!opened.rerun || seq > this.replayed.length) return false;
    const recorded = seq === 0 ? opened.firstIssued : this.replayed[seq - 1]!.issuedAfter;
    if (recorded === undefined || recorded === issued) return false;
    this.control.diverge(
      seq === 0
        ? `its first run made ${issued} calls, where it had made ${recorded}`
        : `after result ${seq} it had made ${issued} calls, where it had made ${recorded}`,
    );
    return true;
  }

  onIdle(seq: number, issued: number): void {
    if (this.stopped || this.issuedDiffers(seq, issued)) return;
    this.acks.set(seq, issued);
    if (!this.replaying) {
      if (seq === 0 && this.control.opened.rerun) Effect.runFork(this.release());
      if (seq === this.journalLength) Effect.runFork(this.pump());
      return;
    }
    if (seq !== this.nextReplayed) return;
    const next = this.replayed[seq];
    if (next !== undefined) {
      if (next.id > issued)
        this.control.diverge(`it waits without making call ${next.id}, which it made before`);
      return;
    }
    this.replaying = false;
    Effect.runFork(this.pump());
    Effect.runFork(this.release());
  }

  private release(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const gate = this.gate.promise;
      yield* Effect.promise(() => gate);
      if (this.stopped || this.released) return;
      const calls = this.held.splice(0);
      if (this.control.opened.rerun && !(yield* this.sameAsBefore(calls))) return;
      this.released = true;
      this.waiting.push(...calls, ...this.held.splice(0));
      this.launchCovered();
    });
  }

  private sameAsBefore(calls: readonly portableTypes.CodemodeHostCall[]): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const { control } = this;
      for (const call of calls) {
        const other = yield* Effect.exit(priorCall(control.host, call));
        if (Exit.isFailure(other)) {
          control.fail(Cause.squash(other.cause));
          return false;
        }
        if (this.stopped) return false;
        if (other.value !== undefined) {
          control.diverge(`call ${call.id} is ${describeCall(call)}, but was ${other.value}`);
          return false;
        }
      }
      return true;
    });
  }

  private launchCovered(): void {
    if (!this.released || this.stopped) return;
    const covered = this.waiting.filter((call) => call.id <= this.durableIssued);
    if (covered.length === 0) return;
    this.waiting = this.waiting.filter((call) => call.id > this.durableIssued);
    for (const call of covered) this.launch(call);
  }

  private launch(call: portableTypes.CodemodeHostCall): void {
    if (this.stopped) return;
    Effect.runPromise(settleCall(this.control.host, call)).then(
      (settled) => this.settled(settled),
      (error: unknown) => this.callFailed(call, error),
    );
  }

  private settled(settled: runDocsTypes.Settled): void {
    this.queue.push(settled);
    Effect.runFork(this.pump());
  }

  private pump(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.committing || this.stopped) return;
      if (this.queue.length === 0 && this.acks.size === 0) return;
      this.committing = true;
      const batch = this.queue.splice(0);
      const acks = [...this.acks];
      this.acks.clear();
      const { api, context } = this.control.host;
      const appended = yield* Effect.exit(appendJournal(api, context, acks, batch));
      if (Exit.isFailure(appended)) {
        this.control.fail(Cause.squash(appended.cause));
        return;
      }
      for (const [, issued] of acks) this.durableIssued = Math.max(this.durableIssued, issued);
      const run = this.control.run();
      for (const item of batch) {
        this.journalLength++;
        if (!run.finished) run.deliver(this.journalLength, item.at, item.id, item.outcome);
      }
      this.launchCovered();
      this.committing = false;
      yield* this.pump();
    });
  }
}
