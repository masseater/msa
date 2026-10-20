import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import type transactionTypes from "../session/transaction.types.ts";
import bridge from "./bridge.ts";
import inboxModule from "./inbox.ts";
import SubmissionHandle from "./submission-handle.ts";
import submissionsAdmit from "./submissions-admit.ts";
import type submissionsTypes from "./submissions.types.ts";
import type typesModule from "./types.types.ts";
import util from "./util.ts";

const { Waiters, closedError } = util;
const { toPromise } = bridge;
const { admitSubmission } = submissionsAdmit;

const { removeInboxItem } = inboxModule;

const isSettled = (
  record: typesModule.SubmissionRecord,
): record is typesModule.SettledSubmissionRecord =>
  record.status === "done" || record.status === "unanswered";

export default class Submissions {
  readonly #session: submissionsTypes.SessionImpl;
  readonly #storage: typesModule.Storage;
  readonly #now: () => number;
  readonly #queueModes: () => submissionsTypes.QueueModes;
  readonly #resume: () => void;
  readonly #waiters = new Waiters<typesModule.SubmissionId, typesModule.SettledSubmissionRecord>();
  #closed = false;

  constructor(
    session: submissionsTypes.SessionImpl,
    storage: typesModule.Storage,
    now: () => number,
    queueModes: () => submissionsTypes.QueueModes,
    resume: () => void,
  ) {
    this.#session = session;
    this.#storage = storage;
    this.#now = now;
    this.#queueModes = queueModes;
    this.#resume = resume;
    session.observeCommits((publication) => {
      this.#observe(publication);
    });
    session.subscribeClose(() => {
      this.#closed = true;
      this.#waiters.rejectAll(closedError(this.#session));
    });
  }

  submit(
    conversationId: typesModule.ConversationId,
    draft: typesModule.SubmissionDraft,
    context: chordTypes.Context,
  ): Promise<typesModule.Submission> {
    this.#resume();
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const admit = yield* toPromise((tx: transactionTypes.Transaction) =>
          admitSubmission(tx, conversationId, draft, this.#now(), this.#queueModes()),
        );
        const id = yield* Effect.promise(() => this.#session.commitWith(admit, context));
        return new SubmissionHandle(id, this);
      }),
    );
  }

  get(
    id: typesModule.SubmissionId,
    context: chordTypes.Context,
  ): Promise<typesModule.Submission | undefined> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const record = yield* Effect.promise(() =>
          this.#session.readOnLine(() => this.#storage.submission(id, context)),
        );
        return record === undefined ? undefined : new SubmissionHandle(record.id, this);
      }),
    );
  }

  status(
    id: typesModule.SubmissionId,
    context: chordTypes.Context,
  ): Promise<typesModule.SubmissionRecord> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const record = yield* Effect.promise(() =>
          this.#session.readOnLine(() => this.#storage.submission(id, context)),
        );
        if (record === undefined)
          return yield* Effect.die(new Error(`Submission ${id} does not exist`));
        return record;
      }),
    );
  }

  wait(
    id: typesModule.SubmissionId,
    context: chordTypes.Context,
  ): Promise<typesModule.SettledSubmissionRecord> {
    this.#resume();
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const pending = yield* toPromise(() => this.#pending(id, context));
        const found = yield* Effect.promise(() => this.#session.readOnLine(pending));
        return yield* Effect.promise(() => found.promise);
      }),
    );
  }

  abort(
    id: typesModule.SubmissionId,
    context: chordTypes.Context,
    conversationId?: typesModule.ConversationId,
  ): Promise<submissionsTypes.AbortResult | "not_found"> {
    return this.#session.commitWith(
      (tx) => Effect.runPromise(this.#abort(tx, id, conversationId)),
      context,
    );
  }

  abortHandle(
    id: typesModule.SubmissionId,
    context: chordTypes.Context,
  ): Promise<submissionsTypes.AbortResult> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const result = yield* Effect.promise(() => this.abort(id, context));
        if (result === "not_found")
          return yield* Effect.die(new Error(`Submission ${id} does not exist`));
        return result;
      }),
    );
  }

  #abort = Effect.fnUntraced(function* (
    this: Submissions,
    tx: transactionTypes.Transaction,
    id: typesModule.SubmissionId,
    conversationId: typesModule.ConversationId | undefined,
  ) {
    const record = yield* Effect.promise(() => tx.submission(id));
    if (
      record === undefined ||
      (conversationId !== undefined && record.conversationId !== conversationId)
    )
      return yield* Effect.succeed<submissionsTypes.AbortResult | "not_found">("not_found");
    if (record.status === "queued") {
      tx.settleSubmission(id, { reason: "aborted", status: "unanswered" });
      yield* removeInboxItem(tx, record.conversationId, id);
      return yield* Effect.succeed<submissionsTypes.AbortResult | "not_found">("aborted");
    }
    return yield* Effect.succeed<submissionsTypes.AbortResult | "not_found">(
      record.status === "placed" ? "already_placed" : "settled",
    );
  });

  #pending = Effect.fnUntraced(function* (
    this: Submissions,
    id: typesModule.SubmissionId,
    context: chordTypes.Context,
  ) {
    const record = yield* Effect.promise(() => this.#storage.submission(id, context));
    if (record === undefined)
      return yield* Effect.die(new Error(`Submission ${id} does not exist`));
    if (isSettled(record)) return { promise: Promise.resolve(record) };
    if (this.#closed) return yield* Effect.die(closedError(this.#session));
    return { promise: this.#waiters.add(id, context) };
  });

  #observe(publication: typesModule.CommitPublication): void {
    for (const change of publication.changes) {
      if (change.type !== "submission" || !isSettled(change.value)) continue;
      this.#waiters.resolve(change.value.id, change.value);
    }
  }
}
