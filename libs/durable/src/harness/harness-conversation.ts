import type { AttachedReplicatedState, Context } from "@msa/chord";
import { Effect } from "effect";

import { ResetEntry } from "../entries.ts";
import { configure } from "./agent.ts";
import { createCompaction } from "./compaction.ts";
import { readContext } from "./context.ts";
import type { ConversationHost } from "./harness-host.ts";
import type {
  Agent,
  AgentChange,
  CompactionResult,
  ContextView,
  Conversation,
  ConversationAbortOptions,
  ConversationCreateOptions,
  ConversationId,
  ConversationWatch,
  Cursor,
  EntryId,
  EntryQuery,
  EntryRecord,
  Page,
  Submission,
  SubmissionDraft,
  TaskId,
  ToolRegistration,
  Tx,
} from "./types.ts";
import type { ConversationView } from "./view.ts";

const boundedQuery = (
  conversationId: ConversationId,
  query: Omit<EntryQuery, "conversationId">,
): EntryQuery => ({
  conversationId,
  ...(query.minEntryId === undefined ? {} : { minEntryId: query.minEntryId }),
  ...(query.maxEntryId === undefined ? {} : { maxEntryId: query.maxEntryId }),
  ...(query.order === undefined ? {} : { order: query.order }),
});

export class ConversationImpl<Tool extends ToolRegistration> implements Conversation {
  readonly id: ConversationId;
  readonly #host: ConversationHost<Tool>;

  constructor(id: ConversationId, host: ConversationHost<Tool>) {
    this.id = id;
    this.#host = host;
  }

  agent(context: Context): Promise<Agent> {
    return this.#host.harness.resolveAgent(this.id, undefined, context);
  }

  configure(change: AgentChange, context: Context): Promise<void> {
    return this.#host.harness.commitWith((tx) => configure(tx, this.id, change), context);
  }

  submit(submission: SubmissionDraft, context: Context): Promise<Submission> {
    return this.#host.submissions.submit(this.id, submission, context);
  }

  compact(instructions: string | undefined, context: Context): Promise<TaskId<CompactionResult>> {
    this.#host.tasks.resume();
    const input = {
      reason: "manual",
      ...(instructions === undefined ? {} : { instructions }),
    } as const;
    return this.#host.harness.commitWith(
      (tx) => Effect.runPromise(createCompaction(tx, this.id, input)),
      context,
    );
  }

  reset(handoff: string | undefined, context: Context): Promise<void> {
    const model =
      handoff === undefined
        ? {}
        : { model: [{ role: "user", content: handoff, timestamp: this.#host.now() } as const] };
    const entry = { kind: ResetEntry.kind, head: "self", ...model } as const;
    return Effect.runPromise(
      Effect.asVoid(
        Effect.promise(() =>
          this.#host.submissions.submit(this.id, { type: "write", entry }, context),
        ),
      ),
    );
  }

  commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T> {
    return this.#host.harness.commitWith(change, context, { conversationId: this.id });
  }

  context(context: Context, options?: { readonly at?: EntryId }): Promise<ContextView> {
    return Effect.runPromise(
      readContext(this.#host.harness, this.#host.storage, this.id, context, options?.at),
    );
  }

  entries(
    query: Omit<EntryQuery, "conversationId">,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<EntryRecord, Cursor>> {
    const bounded = boundedQuery(this.id, query);
    return this.#host.harness.readOnLine(() =>
      this.#host.storage.scanEntries(bounded, limit, cursor, context),
    );
  }

  fork(at: EntryId, options: ConversationCreateOptions, context: Context): Promise<Conversation> {
    return this.#host.create(
      { kind: "fork", parentId: this.id, at, ownership: options.ownership },
      options,
      context,
    );
  }

  abort(context: Context, options?: ConversationAbortOptions): Promise<void> {
    this.#host.tasks.resume();
    return this.#host.tasks.abortConversation(this.id, options?.background === true, context);
  }

  waitForIdle(context: Context): Promise<void> {
    this.#host.tasks.resume();
    return this.#host.tasks.waitForIdle(this.id, context);
  }

  viewState(context: Context): Promise<AttachedReplicatedState<ConversationView>> {
    return this.#host.views.state(this.id, context);
  }

  watch(context: Context): Promise<ConversationWatch> {
    return this.#host.views.watch(this.id, context);
  }
}
