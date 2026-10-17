import { copyJson, type Draft, type JsonRepresentation } from "@msa/chord";
import { Effect, Function } from "effect";

import { ConversationBusy } from "../errors.ts";
import { startRun } from "./generation-run.ts";
import {
  appendInput,
  applyBoundary,
  type Boundary,
  hasQueuedReset,
  InboxDoc,
  isDisplayOnly,
  isStale,
  pickInputEntry,
  prepareBoundary,
  type QueueModes,
} from "./inbox.ts";
import { LiveDoc, type LiveState } from "./live.ts";
import type {
  ConversationId,
  Dual5,
  EntryDraft,
  InputEntry,
  JsonObject,
  SubmissionDraft,
  SubmissionId,
  Tx,
  UserInput,
} from "./types.ts";

type RequestId = { readonly requestId?: string };

const checkInputEntry = (entry: InputEntry): void => {
  const { kind } = entry;
  if (typeof kind !== "string" || kind.length === 0 || kind.startsWith("msa.")) {
    throw new TypeError(
      `An input entry's kind must be a non-empty string not starting with "msa.", got ${String(kind)}`,
    );
  }
};

const existingSubmission = Effect.fn("existingSubmission")(function* (
  tx: Tx,
  conversationId: ConversationId,
  draft: SubmissionDraft,
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

const writeDirectly = Effect.fn("writeDirectly")(function* (
  tx: Tx,
  conversationId: ConversationId,
  requestId: RequestId,
  entry: EntryDraft,
) {
  const appended = yield* Effect.promise(() => tx.appendEntry(conversationId, entry));
  const write = {
    conversationId,
    ...requestId,
    type: "write",
    status: "done",
    entry: appended.id,
  } as const;
  return (yield* Effect.promise(() => tx.createSubmission(write))).id;
});

const queueDraft = Effect.fn("queueDraft")(function* (
  tx: Tx,
  conversationId: ConversationId,
  state: { readonly draft: SubmissionDraft; readonly requestId: RequestId },
  boundary: Boundary | undefined,
) {
  const { draft, requestId } = state;
  const { id } = yield* Effect.promise(() =>
    tx.createSubmission({ conversationId, ...requestId, type: draft.type, status: "queued" }),
  );
  const value = copyJson(draft.type === "write" ? draft.entry : draft.content, {
    omitUndefinedProperties: true,
  });
  const inbox = boundary?.inbox ?? (yield* Effect.promise(() => tx.doc(InboxDoc, conversationId)));
  if (draft.type === "write") inbox.items.push({ id, mode: "write", entry: value as JsonObject });
  else {
    const mode = draft.whenBusy === "steer" ? "steer" : "followUp";
    const content = value as JsonRepresentation<UserInput>;
    const entry = draft.entry === undefined ? {} : { entry: pickInputEntry(draft.entry) };
    inbox.items.push({ id, mode, content, ...entry });
  }
  return id;
});

const placeInput = Effect.fn("placeInput")(function* (
  tx: Tx,
  conversationId: ConversationId,
  state: {
    readonly draft: Extract<SubmissionDraft, { type: "input" }>;
    readonly requestId: RequestId;
    readonly now: number;
    readonly live: Draft<LiveState>;
  },
) {
  const { draft, requestId, now } = state;
  const entry = yield* appendInput(tx, conversationId, draft.content, draft.entry, now);
  const { id } = yield* Effect.promise(() =>
    tx.createSubmission({
      conversationId,
      ...requestId,
      type: "input",
      status: "placed",
      entry: entry.id,
    }),
  );
  yield* startRun(tx, conversationId, state.live, [id]);
  return id;
});

const placeWrite = Effect.fn("placeWrite")(function* (
  tx: Tx,
  conversationId: ConversationId,
  state: {
    readonly draft: Extract<SubmissionDraft, { type: "write" }>;
    readonly requestId: RequestId;
    readonly boundary: Boundary;
  },
) {
  const { draft, requestId, boundary } = state;
  if (isStale(boundary, draft.entry)) {
    const stale = { status: "unanswered", reason: "stale" } as const;
    const created = yield* Effect.promise(() =>
      tx.createSubmission({ conversationId, ...requestId, type: "write", ...stale }),
    );
    return created.id;
  }
  return yield* writeDirectly(tx, conversationId, requestId, draft.entry);
});

export const admitSubmission: Dual5<
  Tx,
  ConversationId,
  SubmissionDraft,
  number,
  QueueModes,
  Effect.Effect<SubmissionId>
> = Function.dual(
  5,
  Effect.fn("admitSubmission")(function* (
    tx: Tx,
    conversationId: ConversationId,
    draft: SubmissionDraft,
    now: number,
    queueModes: QueueModes,
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
      if (users.length > 0) yield* startRun(tx, conversationId, live, users);
      return id;
    }
    if (draft.type === "write")
      return yield* placeWrite(tx, conversationId, { draft, requestId, boundary });
    return yield* placeInput(tx, conversationId, { draft, requestId, now, live });
  }),
);
