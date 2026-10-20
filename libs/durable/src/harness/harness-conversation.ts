import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import entriesModule from "../entries.ts";
import agentModule from "./agent.ts";
import compaction from "./compaction.ts";
import contextModule from "./context.ts";
import type harnessHostTypes from "./harness-host.ts";
import type typesModule from "./types.types.ts";
import type viewTypes from "./view.types.ts";

const { configure } = agentModule;
const { createCompaction } = compaction;
const { ResetEntry } = entriesModule;
const { readContext } = contextModule;

const boundedQuery = (
  conversationId: typesModule.ConversationId,
  query: Omit<typesModule.EntryQuery, "conversationId">,
): typesModule.EntryQuery => ({
  conversationId,
  ...(query.minEntryId === undefined ? {} : { minEntryId: query.minEntryId }),
  ...(query.maxEntryId === undefined ? {} : { maxEntryId: query.maxEntryId }),
  ...(query.order === undefined ? {} : { order: query.order }),
});

export default class ConversationImpl<Tool extends typesModule.ToolRegistration>
  implements typesModule.Conversation
{
  readonly id: typesModule.ConversationId;
  readonly #host: harnessHostTypes.ConversationHost<Tool>;

  constructor(id: typesModule.ConversationId, host: harnessHostTypes.ConversationHost<Tool>) {
    this.id = id;
    this.#host = host;
  }

  agent(context: chordTypes.Context): Promise<typesModule.Agent> {
    return this.#host.harness.resolveAgent(this.id, undefined, context);
  }

  configure(change: typesModule.AgentChange, context: chordTypes.Context): Promise<void> {
    return this.#host.harness.commitWith((tx) => configure(tx, this.id, change), context);
  }

  submit(
    submission: typesModule.SubmissionDraft,
    context: chordTypes.Context,
  ): Promise<typesModule.Submission> {
    return this.#host.submissions.submit(this.id, submission, context);
  }

  compact(
    instructions: string | undefined,
    context: chordTypes.Context,
  ): Promise<typesModule.TaskId<typesModule.CompactionResult>> {
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

  reset(handoff: string | undefined, context: chordTypes.Context): Promise<void> {
    const model =
      handoff === undefined
        ? {}
        : { model: [{ content: handoff, role: "user", timestamp: this.#host.now() } as const] };
    const entry = { head: "self", kind: ResetEntry.kind, ...model } as const;
    return Effect.runPromise(
      Effect.asVoid(
        Effect.promise(() =>
          this.#host.submissions.submit(this.id, { entry, type: "write" }, context),
        ),
      ),
    );
  }

  commit<T>(
    change: (tx: typesModule.Tx) => T | Promise<T>,
    context: chordTypes.Context,
  ): Promise<T> {
    return this.#host.harness.commitWith(change, context, { conversationId: this.id });
  }

  context(
    context: chordTypes.Context,
    options?: { readonly at?: typesModule.EntryId },
  ): Promise<typesModule.ContextView> {
    return Effect.runPromise(
      readContext(this.#host.harness, this.#host.storage, this.id, context, options?.at),
    );
  }

  entries(
    query: Omit<typesModule.EntryQuery, "conversationId">,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: chordTypes.Context,
  ): Promise<typesModule.Page<typesModule.EntryRecord, typesModule.Cursor>> {
    const bounded = boundedQuery(this.id, query);
    return this.#host.harness.readOnLine(() =>
      this.#host.storage.scanEntries(bounded, limit, cursor, context),
    );
  }

  fork(
    at: typesModule.EntryId,
    options: typesModule.ConversationCreateOptions,
    context: chordTypes.Context,
  ): Promise<typesModule.Conversation> {
    return this.#host.create(
      { at, kind: "fork", ownership: options.ownership, parentId: this.id },
      options,
      context,
    );
  }

  abort(
    context: chordTypes.Context,
    options?: typesModule.ConversationAbortOptions,
  ): Promise<void> {
    this.#host.tasks.resume();
    return this.#host.tasks.abortConversation(this.id, options?.background === true, context);
  }

  waitForIdle(context: chordTypes.Context): Promise<void> {
    this.#host.tasks.resume();
    return this.#host.tasks.waitForIdle(this.id, context);
  }

  viewState(
    context: chordTypes.Context,
  ): Promise<chordTypes.AttachedReplicatedState<viewTypes.ConversationView>> {
    return this.#host.views.state(this.id, context);
  }

  watch(context: chordTypes.Context): Promise<typesModule.ConversationWatch> {
    return this.#host.views.watch(this.id, context);
  }
}
