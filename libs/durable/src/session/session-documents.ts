import trackerModule from "@msa/chord/delta/tracker";
import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import documentsModule from "../documents.ts";
import type dualTypes from "../dual.ts";
import type typesModule from "../types.types.ts";
import unrefTimer from "../unref-timer.ts";
import type sessionDocumentsTypes from "./session-documents.types.ts";
import sessionState from "./session-state.ts";
import type sessionStateTypes from "./session-state.types.ts";

const { track } = trackerModule;

const { startUnrefTimer } = unrefTimer;

const { enqueue } = sessionState;
const { materializeDocument } = documentsModule;

const MAX_TIMER_DELAY = 2_147_483_647;

const dropDocument: dualTypes.Dual2<sessionStateTypes.SessionState, string, void> = Function.dual(
  2,
  (state: sessionStateTypes.SessionState, addressId: string): void => {
    state.documents.delete(addressId);
    state.idleDocuments.delete(addressId);
  },
);

const clearDocumentSweep = (state: sessionStateTypes.SessionState): void => {
  state.documentSweep?.timer?.cancel();
  state.documentSweep = undefined;
};

const runSweep =
  (state: sessionStateTypes.SessionState, sweep: sessionStateTypes.DocumentSweep) => (): void => {
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

const startTimer = (
  state: sessionStateTypes.SessionState,
  sweep: sessionStateTypes.DocumentSweep,
  delay: number,
): void => {
  const timer = startUnrefTimer(runSweep(state, sweep), Math.min(delay, MAX_TIMER_DELAY));
  if (timer === undefined) {
    state.documentTimersUnavailable = true;
    state.documentSweep = undefined;
    return;
  }
  sweep.timer = timer;
};

const scheduleDocumentSweep = (state: sessionStateTypes.SessionState): void => {
  if (state.closing !== undefined) return;
  const oldest = state.idleDocuments.values().next();
  if (oldest.done === true) return;
  const at = oldest.value + state.documentRetentionMs();
  if (state.documentSweep !== undefined && state.documentSweep.at <= at) return;
  clearDocumentSweep(state);
  const sweep: sessionStateTypes.DocumentSweep = { at, timer: undefined };
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

const sweepDocuments = (state: sessionStateTypes.SessionState): void => {
  const expired = state.clock() - state.documentRetentionMs();
  for (const [addressId, since] of state.idleDocuments) {
    if (since > expired) break;
    dropDocument(state, addressId);
  }
  scheduleDocumentSweep(state);
};

const touchDocument: dualTypes.Dual2<sessionStateTypes.SessionState, string, void> = Function.dual(
  2,
  (state: sessionStateTypes.SessionState, addressId: string): void => {
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

const pinDocument: dualTypes.Dual3<
  sessionStateTypes.SessionState,
  string,
  typesModule.DocumentId,
  () => void
> = Function.dual(
  3,
  (
    state: sessionStateTypes.SessionState,
    addressId: string,
    recordId: typesModule.DocumentId,
  ): (() => void) => {
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

const loadDocument: dualTypes.Dual5<
  sessionStateTypes.SessionState,
  sessionDocumentsTypes.AnyDocDefinition,
  string,
  typesModule.DocumentAddress,
  chordTypes.Context,
  Effect.Effect<sessionDocumentsTypes.LoadedDocument | undefined>
> = Function.dual(
  5,
  Effect.fnUntraced(function* (
    state: sessionStateTypes.SessionState,
    definition: sessionDocumentsTypes.AnyDocDefinition,
    addressId: string,
    address: typesModule.DocumentAddress,
    context: chordTypes.Context,
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
    const loaded: sessionDocumentsTypes.LoadedDocument = {
      addressId,
      deltasSinceBase: stored.deltasSinceBase,
      record: stored.record,
      storedVersion: stored.version,
      tracker: track(materializeDocument(definition, stored)),
      valueVersion: definition.version,
    };
    state.documents.set(addressId, loaded);
    touchDocument(state, addressId);
    return loaded;
  }),
);

const sessionDocuments = {
  clearDocumentSweep,
  dropDocument,
  loadDocument,
  pinDocument,
  scheduleDocumentSweep,
  sweepDocuments,
  touchDocument,
};

export default sessionDocuments;
