import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import SessionImpl from "../session/session.ts";
import type transactionTypes from "../session/transaction.types.ts";
import ConversationImpl from "./harness-conversation.ts";
import harnessDocs from "./harness-docs.ts";
import type harnessImplTypes from "./harness-impl.types.ts";
import harnessQueries from "./harness-queries.ts";
import harnessWiring from "./harness-wiring.ts";
import type typesModule from "./types.types.ts";

const { harnessClock, wireHarness } = harnessWiring;
const { buildEnv, conversationAgent, inspectHarness, totalUsage } = harnessQueries;
const { createConversation, initializeConversation } = harnessDocs;

type Host<Tool extends typesModule.ToolRegistration> = ConstructorParameters<
  typeof ConversationImpl<Tool>
>[1];
type CreateArgs<Tool extends typesModule.ToolRegistration> = Parameters<Host<Tool>["create"]>;

const SCHEDULER_INDEX_SIZES = Symbol.for("msa-durable.schedulerIndexSizes");

class HarnessImpl<Tool extends typesModule.ToolRegistration>
  extends SessionImpl
  implements typesModule.Harness
{
  readonly #options: typesModule.HarnessOptions<Tool>;
  readonly #wired: harnessImplTypes.Wired;
  readonly #host: Host<Tool>;

  constructor(
    rawStorage: typesModule.Storage,
    options: typesModule.HarnessOptions<Tool>,
    context: chordTypes.Context,
  ) {
    const clock = harnessClock(options);
    super(rawStorage, clock.now, () => options.settings?.documentRetentionMs);
    const storage = this.storage;
    this.#options = options;
    this.#wired = wireHarness({ clock, context, host: this, options, storage });
    const { tasks, submissions, views, now } = this.#wired;
    this.#host = {
      create: (target, createOptions, ctx) => this.#create(target, createOptions, ctx),
      harness: this,
      now,
      storage,
      submissions,
      tasks,
      views,
    };
  }

  resolveAgent(
    id: typesModule.ConversationId,
    snapshot: typesModule.RegistrySnapshot<Tool> | undefined,
    context: chordTypes.Context,
  ): Promise<typesModule.Agent<Tool>> {
    const query = { options: this.#options, report: this.#wired.report, session: this };
    return Effect.runPromise(conversationAgent(query, id, snapshot, context));
  }

  buildEnv(
    id: typesModule.ConversationId,
    context: chordTypes.Context,
  ): Promise<harnessImplTypes.BuiltEnv> {
    return Effect.runPromise(buildEnv(this, this.#options, id, context));
  }

  openTasks(context: chordTypes.Context): Promise<void> {
    return this.#wired.tasks.open(context);
  }

  resume(): void {
    this.assertUsable();
    this.#wired.tasks.resume();
  }

  getTask<R>(
    id: typesModule.TaskId<R>,
    context: chordTypes.Context,
  ): Promise<typesModule.TaskRecord<chordTypes.JsonValue, chordTypes.JsonValue, R> | undefined> {
    return this.readOnLine(() => this.storage.task(id, context)) as Promise<
      typesModule.TaskRecord<chordTypes.JsonValue, chordTypes.JsonValue, R> | undefined
    >;
  }

  get [SCHEDULER_INDEX_SIZES](): harnessImplTypes.Wired["tasks"]["indexSizes"] {
    return this.#wired.tasks.indexSizes;
  }

  inspect(context: chordTypes.Context): Promise<typesModule.HarnessInspection> {
    const query = { session: this, storage: this.storage };
    const snapshot = this.#options.registry.snapshot();
    return Effect.runPromise(inspectHarness(query, this.#wired.tasks, snapshot, context));
  }

  submission(
    id: typesModule.SubmissionId,
    context: chordTypes.Context,
  ): Promise<typesModule.Submission | undefined> {
    return this.#wired.submissions.get(id, context);
  }

  abortSubmission(
    id: typesModule.SubmissionId,
    context: chordTypes.Context,
    conversationId?: typesModule.ConversationId,
  ): Promise<"aborted" | "already_placed" | "settled" | "not_found"> {
    return this.#wired.submissions.abort(id, context, conversationId);
  }

  abortTask(id: typesModule.TaskId, context: chordTypes.Context): Promise<"marked" | "terminal"> {
    return this.#wired.tasks.abort(id, context);
  }

  waitForTask<R>(
    id: typesModule.TaskId<R>,
    context: chordTypes.Context,
  ): Promise<typesModule.SettledTask<R>> {
    this.#wired.tasks.resume();
    return this.#wired.tasks.waitForTask(id, context) as Promise<typesModule.SettledTask<R>>;
  }

  waitForIdle(context: chordTypes.Context): Promise<void> {
    this.#wired.tasks.resume();
    return this.#wired.tasks.waitForIdle(undefined, context);
  }

  usage(context: chordTypes.Context): ReturnType<typesModule.Harness["usage"]> {
    return Effect.runPromise(totalUsage({ session: this, storage: this.storage }, context));
  }

  taskGraph(context: chordTypes.Context): ReturnType<typesModule.Harness["taskGraph"]> {
    return this.#wired.taskGraph.state(context);
  }

  watchTaskGraph(context: chordTypes.Context): ReturnType<typesModule.Harness["watchTaskGraph"]> {
    return this.#wired.taskGraph.watch(context);
  }

  root(
    context: chordTypes.Context,
    options?: {
      readonly agent?: typesModule.AgentChange;
      readonly init?: typesModule.ConversationInit;
    },
  ): Promise<typesModule.Conversation> {
    return this.#create({ kind: "root" }, options ?? {}, context);
  }

  conversation(
    id: typesModule.ConversationId,
    context: chordTypes.Context,
  ): Promise<typesModule.Conversation | undefined> {
    return Effect.runPromise(
      Effect.map(
        Effect.promise(() => {
          this.assertUsable();
          return this.readOnLine(() => this.storage.conversation(id, context));
        }),
        (record) =>
          record === undefined ? undefined : new ConversationImpl(record.id, this.#host),
      ),
    );
  }

  createConversation(
    options: typesModule.ConversationCreateOptions,
    context: chordTypes.Context,
  ): Promise<typesModule.Conversation> {
    return this.#create({ kind: "independent", ownership: options.ownership }, options, context);
  }

  override report(error: unknown): void {
    this.#wired.report(error);
  }

  protected override beforeClose(): Promise<void> {
    return this.#wired.tasks.join();
  }

  #create(
    target: CreateArgs<Tool>[0],
    options: CreateArgs<Tool>[1],
    context: chordTypes.Context,
  ): Promise<typesModule.Conversation> {
    return Effect.runPromise(
      Effect.map(
        Effect.promise(() => {
          this.assertUsable();
          return this.commitWith(
            (tx) => Effect.runPromise(createConversation(tx, target, options)),
            context,
          );
        }),
        (id) => new ConversationImpl(id, this.#host),
      ),
    );
  }

  protected override conversationCreated(
    tx: transactionTypes.Transaction,
    record: typesModule.ConversationRecord,
  ): Promise<void> {
    return Effect.runPromise(initializeConversation(tx, record, this.#options.conversationCreated));
  }
}

const harnessImpl = {
  HarnessImpl,
  SCHEDULER_INDEX_SIZES,
};

export default harnessImpl;
