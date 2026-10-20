import type { Draft, JsonRepresentation } from "@msa/chord";
import { copyJson } from "@msa/chord/json";
import { Effect, Function } from "effect";

import errors from "../errors.ts";
import generationRun from "./generation-run.ts";
import inboxModule from "./inbox.ts";
import type inboxTypes from "./inbox.types.ts";
import liveModule from "./live.ts";
import type liveTypes from "./live.types.ts";
import type typesModule from "./types.types.ts";

const {
  InboxDoc,
  appendInput,
  applyBoundary,
  hasQueuedReset,
  isDisplayOnly,
  isStale,
  pickInputEntry,
  prepareBoundary,
} = inboxModule;
const { LiveDoc } = liveModule;
const { ConversationBusy } = errors;

type RequestId = { readonly requestId?: string };

const checkInputEntry = (entry: typesModule.InputEntry): void => {
  const { kind } = entry;
  if (typeof kind !== "string" || kind.length === 0 || kind.startsWith("msa.")) {
    throw new TypeError(
      `An input entry's kind must be a non-empty string not starting with "msa.", got ${String(kind)}`,
    );
  }
};

const existingSubmission = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  conversationId: typesModule.ConversationId,
  draft: typesModule.SubmissionDraft,
) {
  if (draft.requestId === undefined) return undefined;
  const existing = yield* Effect.promise(() =>
    tx.submissionByRequest(conversationId, draft.requestId!),
  );
  if (existing === undefined) return undefined;
  if (existing.type !== draft.type)
    return yield* Effect.die(
      new Error(
        `Request ${draft.requestId} already identifies a submission of type ${existing.type}`,
      ),
    );
  return existing.id;
});

const writeDirectly = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  conversationId: typesModule.ConversationId,
  requestId: RequestId,
  entry: typesModule.EntryDraft,
) {
  const appended = yield* Effect.promise(() => tx.appendEntry(conversationId, entry));
  const write = {
    conversationId,
    ...requestId,
    entry: appended.id,
    status: "done",
    type: "write",
  } as const;
  return (yield* Effect.promise(() => tx.createSubmission(write))).id;
});

const queueDraft = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  conversationId: typesModule.ConversationId,
  state: { readonly draft: typesModule.SubmissionDraft; readonly requestId: RequestId },
  boundary: inboxTypes.Boundary | undefined,
) {
  const { draft, requestId } = state;
  const { id } = yield* Effect.promise(() =>
    tx.createSubmission({ conversationId, ...requestId, status: "queued", type: draft.type }),
  );
  const value = copyJson(draft.type === "write" ? draft.entry : draft.content, {
    omitUndefinedProperties: true,
  });
  const inbox = boundary?.inbox ?? (yield* Effect.promise(() => tx.doc(InboxDoc, conversationId)));
  if (draft.type === "write")
    inbox.items.push({ entry: value as typesModule.JsonObject, id, mode: "write" });
  else {
    const mode = draft.whenBusy === "steer" ? "steer" : "followUp";
    const content = value as JsonRepresentation<typesModule.UserInput>;
    const entry = draft.entry === undefined ? {} : { entry: pickInputEntry(draft.entry) };
    inbox.items.push({ content, id, mode, ...entry });
  }
  return id;
});

const placeInput = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  conversationId: typesModule.ConversationId,
  state: {
    readonly draft: Extract<typesModule.SubmissionDraft, { type: "input" }>;
    readonly requestId: RequestId;
    readonly now: number;
    readonly live: Draft<liveTypes.LiveState>;
  },
) {
  const { draft, requestId, now } = state;
  const entry = yield* appendInput(tx, conversationId, draft.content, draft.entry, now);
  const { id } = yield* Effect.promise(() =>
    tx.createSubmission({
      conversationId,
      ...requestId,
      entry: entry.id,
      status: "placed",
      type: "input",
    }),
  );
  yield* generationRun.startRun(tx, conversationId, state.live, [id]);
  return id;
});

const placeWrite = Effect.fnUntraced(function* (
  tx: typesModule.Tx,
  conversationId: typesModule.ConversationId,
  state: {
    readonly draft: Extract<typesModule.SubmissionDraft, { type: "write" }>;
    readonly requestId: RequestId;
    readonly boundary: inboxTypes.Boundary;
  },
) {
  const { draft, requestId, boundary } = state;
  if (isStale(boundary, draft.entry)) {
    const stale = { reason: "stale", status: "unanswered" } as const;
    const created = yield* Effect.promise(() =>
      tx.createSubmission({ conversationId, ...requestId, type: "write", ...stale }),
    );
    return created.id;
  }
  return yield* writeDirectly(tx, conversationId, requestId, draft.entry);
});

const admitSubmission: typesModule.Dual5<
  typesModule.Tx,
  typesModule.ConversationId,
  typesModule.SubmissionDraft,
  number,
  inboxTypes.QueueModes,
  Effect.Effect<typesModule.SubmissionId>
> = Function.dual(
  5,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    draft: typesModule.SubmissionDraft,
    now: number,
    queueModes: inboxTypes.QueueModes,
  ) {
    if (draft.type === "input" && draft.entry !== undefined) checkInputEntry(draft.entry);
    const existing = yield* existingSubmission(tx, conversationId, draft);
    if (existing !== undefined) return existing;
    const requestId: RequestId =
      draft.requestId === undefined ? {} : { requestId: draft.requestId };
    if (draft.type === "write" && isDisplayOnly(draft.entry)) {
      const inbox = yield* Effect.promise(() => tx.doc(InboxDoc, conversationId));
      if (!hasQueuedReset(inbox.items))
        return yield* writeDirectly(tx, conversationId, requestId, draft.entry);
    }
    const live = yield* Effect.promise(() => tx.doc(LiveDoc, conversationId));
    const busy = live.run !== undefined;
    if (busy && draft.type === "input" && draft.whenBusy === "reject")
      return yield* Effect.die(new ConversationBusy(conversationId));
    const boundary = busy ? undefined : yield* prepareBoundary(tx, conversationId, queueModes);
    if (boundary === undefined || boundary.inbox.items.length > 0) {
      const id = yield* queueDraft(tx, conversationId, { draft, requestId }, boundary);
      if (boundary === undefined) return id;
      const { users } = yield* applyBoundary(tx, boundary, "final", now);
      if (users.length > 0) yield* generationRun.startRun(tx, conversationId, live, users);
      return id;
    }
    if (draft.type === "write")
      return yield* placeWrite(tx, conversationId, { boundary, draft, requestId });
    return yield* placeInput(tx, conversationId, { draft, live, now, requestId });
  }),
);

const submissionsAdmit = {
  admitSubmission,
};

export default submissionsAdmit;
