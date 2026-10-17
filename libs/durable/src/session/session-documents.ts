import type { Context } from "@msa/chord";
import { track } from "@msa/chord/delta";
import { Effect, Function } from "effect";

import { type AnyDocDefinition, materializeDocument } from "../documents.ts";
import type { Dual2, Dual3, Dual5 } from "../dual.ts";
import type { DocumentAddress, DocumentId } from "../types.ts";
import { type DocumentSweep, enqueue, type SessionState } from "./session-state.ts";
import type { LoadedDocument } from "./transaction-types.ts";

const MAX_TIMER_DELAY = 2_147_483_647;

export const dropDocument: Dual2<SessionState, string, void> = Function.dual(
  2,
  (state: SessionState, addressId: string): void => {
    state.documents.delete(addressId);
    state.idleDocuments.delete(addressId);
  },
);

export const clearDocumentSweep = (state: SessionState): void => {
  if (state.documentSweep?.timer !== undefined) clearTimeout(state.documentSweep.timer);
  state.documentSweep = undefined;
};

const runSweep = (state: SessionState, sweep: DocumentSweep) => (): void => {
  state.sweepJobs++;
  enqueue(state, () =>
    Effect.runPromise(
      Effect.sync(() => {
        if (state.documentSweep === sweep) state.documentSweep = undefined;
        if (state.closing === undefined) sweepDocuments(state);
      }),
    ),
  ).catch(() => {});
};

const startTimer = (state: SessionState, sweep: DocumentSweep, delay: number): void => {
  const timer = setTimeout(runSweep(state, sweep), Math.min(delay, MAX_TIMER_DELAY));
  const unref = (timer as { unref?: unknown }).unref;
  if (typeof unref !== "function") {
    clearTimeout(timer);
    state.documentTimersUnavailable = true;
    state.documentSweep = undefined;
    return;
  }
  unref.call(timer);
  sweep.timer = timer;
};

export const scheduleDocumentSweep = (state: SessionState): void => {
  if (state.closing !== undefined) return;
  const oldest = state.idleDocuments.values().next();
  if (oldest.done === true) return;
  const at = oldest.value + state.documentRetentionMs();
  if (state.documentSweep !== undefined && state.documentSweep.at <= at) return;
  clearDocumentSweep(state);
  const sweep: DocumentSweep = { at, timer: undefined };
  const delay = at - state.clock();
  state.documentSweep = sweep;
  if (delay <= 0) {
    queueMicrotask(runSweep(state, sweep));
    return;
  }
  if (state.documentTimersUnavailable) {
    state.documentSweep = undefined;
    return;
  }
  startTimer(state, sweep, delay);
};

export const sweepDocuments = (state: SessionState): void => {
  const expired = state.clock() - state.documentRetentionMs();
  for (const [addressId, since] of state.idleDocuments) {
    if (since > expired) break;
    dropDocument(state, addressId);
  }
  scheduleDocumentSweep(state);
};

export const touchDocument: Dual2<SessionState, string, void> = Function.dual(
  2,
  (state: SessionState, addressId: string): void => {
    const cached = state.documents.get(addressId);
    if (cached === undefined || state.attachedDocuments.has(cached.record.id)) return;
    const now = state.clock();
    const since = state.idleDocuments.get(addressId);
    if (since !== undefined && now - since < Math.min(1_000, state.documentRetentionMs() / 10))
      return;
    state.idleDocuments.delete(addressId);
    state.idleDocuments.set(addressId, now);
    if (
      state.documentSweep === undefined ||
      state.documentSweep.at > now + state.documentRetentionMs()
    )
      scheduleDocumentSweep(state);
  },
);

export const pinDocument: Dual3<SessionState, string, DocumentId, () => void> = Function.dual(
  3,
  (state: SessionState, addressId: string, recordId: DocumentId): (() => void) => {
    const attached = state.attachedDocuments;
    attached.set(recordId, (attached.get(recordId) ?? 0) + 1);
    state.idleDocuments.delete(addressId);
    let pinned = true;
    return () => {
      if (!pinned) return;
      pinned = false;
      const count = (attached.get(recordId) ?? 1) - 1;
      if (count > 0) {
        attached.set(recordId, count);
        return;
      }
      attached.delete(recordId);
      if (state.documents.get(addressId)?.record.id === recordId) touchDocument(state, addressId);
    };
  },
);

export const loadDocument: Dual5<
  SessionState,
  AnyDocDefinition,
  string,
  DocumentAddress,
  Context,
  Effect.Effect<LoadedDocument | undefined>
> = Function.dual(
  5,
  Effect.fn("loadDocument")(function* (
    state: SessionState,
    definition: AnyDocDefinition,
    addressId: string,
    address: DocumentAddress,
    context: Context,
  ) {
    const cached = state.documents.get(addressId);
    if (cached?.valueVersion === definition.version) {
      touchDocument(state, addressId);
      return cached;
    }
    if (cached !== undefined) dropDocument(state, addressId);
    const record = yield* Effect.promise(() =>
      state.storage.findDocument(address, "current", context),
    );
    if (record === undefined) return undefined;
    const stored = yield* Effect.promise(() =>
      state.storage.document(record.id, "current", context),
    );
    if (stored === undefined)
      throw new Error(`Current document ${record.id} (${record.kind}) cannot be read`);
    const loaded: LoadedDocument = {
      addressId,
      record: stored.record,
      storedVersion: stored.version,
      valueVersion: definition.version,
      deltasSinceBase: stored.deltasSinceBase,
      tracker: track(materializeDocument(definition, stored)),
    };
    state.documents.set(addressId, loaded);
    touchDocument(state, addressId);
    return loaded;
  }),
);
