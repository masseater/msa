import type { Context } from "@msa/chord";
import { BACKGROUND_CONTEXT, awaitWithContext, withoutAbortSignal } from "@msa/chord/context";
import { Cause, Effect, Function } from "effect";

import type dualTypes from "../dual.ts";
import errors from "../errors.ts";
import sessionDocuments from "./session-documents.ts";
import sessionState from "./session-state.ts";
import type sessionStateTypes from "./session-state.types.ts";

const { clearDocumentSweep } = sessionDocuments;
const { contained, enqueue } = sessionState;
const { SessionFailed } = errors;

const notifyClose = (state: sessionStateTypes.SessionState): void => {
  clearDocumentSweep(state);
  const listeners = [...state.closeListeners];
  state.closeListeners.clear();
  for (const listener of listeners) contained(listener, (error) => state.hooks.report(error));
};

const closeStorage = (state: sessionStateTypes.SessionState, cleanup: Context) =>
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

const settleClosed = (state: sessionStateTypes.SessionState): void => {
  const failure = state.failure;
  state.closed.resolve(
    failure === undefined ? { reason: "closed" } : { error: failure.error, reason: "failed" },
  );
};

const closeSession: dualTypes.Dual2<
  sessionStateTypes.SessionState,
  Context,
  Promise<void>
> = Function.dual(2, (state: sessionStateTypes.SessionState, context: Context): Promise<void> => {
  if (state.closing === undefined) {
    const cleanup = withoutAbortSignal(context);
    state.closing = Promise.resolve()
      .then(() => state.hooks.beforeClose())
      .then(() => enqueue(state, () => Effect.runPromise(closeStorage(state, cleanup))))
      .finally(() => settleClosed(state));
    notifyClose(state);
  }
  return awaitWithContext(state.closing, context);
});

const failSession: dualTypes.Dual2<sessionStateTypes.SessionState, unknown, void> = Function.dual(
  2,
  (state: sessionStateTypes.SessionState, error: unknown): void => {
    if (state.failure !== undefined) return;
    state.failure = { error };
    state.failed.reject(new SessionFailed(error));
    Effect.runFork(
      Effect.ignoreCause(Effect.promise(() => closeSession(state, BACKGROUND_CONTEXT))),
    );
    state.hooks.report(error);
  },
);

const sessionClose = {
  closeSession,
  failSession,
};

export default sessionClose;
