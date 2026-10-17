import type { Context } from "@msa/chord";
import { awaitWithContext, BACKGROUND_CONTEXT, withoutAbortSignal } from "@msa/chord/context";
import { Cause, Effect, Function } from "effect";

import type { Dual2 } from "../dual.ts";
import { SessionFailed } from "../errors.ts";
import { clearDocumentSweep } from "./session-documents.ts";
import { contained, enqueue, type SessionState } from "./session-state.ts";

const notifyClose = (state: SessionState): void => {
  clearDocumentSweep(state);
  const listeners = [...state.closeListeners];
  state.closeListeners.clear();
  for (const listener of listeners) contained(listener, (error) => state.hooks.report(error));
};

const closeStorage = (state: SessionState, cleanup: Context) =>
  Effect.suspend(() => {
    state.commitListeners.clear();
    state.internalListeners.clear();
    state.documents.clear();
    state.idleDocuments.clear();
    state.attachedDocuments.clear();
    return Effect.promise(() => state.storage.close(cleanup));
  }).pipe(
    Effect.onError((cause) =>
      Effect.sync(() => {
        if (state.failure !== undefined) return;
        const error = Cause.squash(cause);
        state.failure = { error };
        state.hooks.report(error);
      }),
    ),
  );

const settleClosed = (state: SessionState): void => {
  const failure = state.failure;
  state.closed.resolve(
    failure === undefined ? { reason: "closed" } : { reason: "failed", error: failure.error },
  );
};

export const closeSession: Dual2<SessionState, Context, Promise<void>> = Function.dual(
  2,
  (state: SessionState, context: Context): Promise<void> => {
    if (state.closing === undefined) {
      const cleanup = withoutAbortSignal(context);
      state.closing = Promise.resolve()
        .then(() => state.hooks.beforeClose())
        .then(() => enqueue(state, () => Effect.runPromise(closeStorage(state, cleanup))))
        .finally(() => settleClosed(state));
      notifyClose(state);
    }
    return awaitWithContext(state.closing, context);
  },
);

export const failSession: Dual2<SessionState, unknown, void> = Function.dual(
  2,
  (state: SessionState, error: unknown): void => {
    if (state.failure !== undefined) return;
    state.failure = { error };
    state.failed.reject(new SessionFailed(error));
    Effect.runFork(
      Effect.ignoreCause(Effect.promise(() => closeSession(state, BACKGROUND_CONTEXT))),
    );
    state.hooks.report(error);
  },
);
