import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type { SessionImpl } from "../session/session.ts";
import type { Transaction } from "../session/transaction.ts";
import { toPromise } from "./bridge.ts";
import type { QueueModes } from "./inbox.ts";
import { removeInboxItem } from "./inbox.ts";
import { SubmissionHandle } from "./submission-handle.ts";
import { admitSubmission } from "./submissions-admit.ts";
import type {
  CommitPublication,
  ConversationId,
  SettledSubmissionRecord,
  Storage,
  Submission,
  SubmissionDraft,
  SubmissionId,
  SubmissionRecord,
} from "./types.ts";
import { closedError, Waiters } from "./util.ts";

export type AbortResult = "aborted" | "already_placed" | "settled";

const isSettled = (record: SubmissionRecord): record is SettledSubmissionRecord =>
  record.status === "done" || record.status === "unanswered";

export class Submissions {
  readonly #session: SessionImpl;
  readonly #storage: Storage;
  readonly #now: () => number;
  readonly #queueModes: () => QueueModes;
  readonly #resume: () => void;
  readonly #waiters = new Waiters<SubmissionId, SettledSubmissionRecord>();
  #closed = false;

  constructor(
    session: SessionImpl,
    storage: Storage,
    now: () => number,
    queueModes: () => QueueModes,
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
    conversationId: ConversationId,
    draft: SubmissionDraft,
    context: Context,
  ): Promise<Submission> {
    this.#resume();
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const admit = yield* toPromise((tx: Transaction) =>
          admitSubmission(tx, conversationId, draft, this.#now(), this.#queueModes()),
        );
        const id = yield* Effect.promise(() => this.#session.commitWith(admit, context));
        return new SubmissionHandle(id, this);
      }),
    );
  }

  get(id: SubmissionId, context: Context): Promise<Submission | undefined> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const record = yield* Effect.promise(() =>
          this.#session.readOnLine(() => this.#storage.submission(id, context)),
        );
        return record === undefined ? undefined : new SubmissionHandle(record.id, this);
      }),
    );
  }

  status(id: SubmissionId, context: Context): Promise<SubmissionRecord> {
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

  wait(id: SubmissionId, context: Context): Promise<SettledSubmissionRecord> {
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
    id: SubmissionId,
    context: Context,
    conversationId?: ConversationId,
  ): Promise<AbortResult | "not_found"> {
    return this.#session.commitWith(
      (tx) => Effect.runPromise(this.#abort(tx, id, conversationId)),
      context,
    );
  }

  abortHandle(id: SubmissionId, context: Context): Promise<AbortResult> {
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
    tx: Transaction,
    id: SubmissionId,
    conversationId: ConversationId | undefined,
  ) {
    const record = yield* Effect.promise(() => tx.submission(id));
    if (
      record === undefined ||
      (conversationId !== undefined && record.conversationId !== conversationId)
    )
      return yield* Effect.succeed<AbortResult | "not_found">("not_found");
    if (record.status === "queued") {
      tx.settleSubmission(id, { status: "unanswered", reason: "aborted" });
      yield* removeInboxItem(tx, record.conversationId, id);
      return yield* Effect.succeed<AbortResult | "not_found">("aborted");
    }
    return yield* Effect.succeed<AbortResult | "not_found">(
      record.status === "placed" ? "already_placed" : "settled",
    );
  });

  #pending = Effect.fnUntraced(function* (this: Submissions, id: SubmissionId, context: Context) {
    const record = yield* Effect.promise(() => this.#storage.submission(id, context));
    if (record === undefined)
      return yield* Effect.die(new Error(`Submission ${id} does not exist`));
    if (isSettled(record)) return { promise: Promise.resolve(record) };
    if (this.#closed) return yield* Effect.die(closedError(this.#session));
    return { promise: this.#waiters.add(id, context) };
  });

  #observe(publication: CommitPublication): void {
    for (const change of publication.changes) {
      if (change.type !== "submission" || !isSettled(change.value)) continue;
      this.#waiters.resolve(change.value.id, change.value);
    }
  }
}
