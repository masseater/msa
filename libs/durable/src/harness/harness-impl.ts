import type { Context, JsonValue } from "@msa/chord";
import { Effect } from "effect";

import { SessionImpl } from "../session/session.ts";
import type { Transaction } from "../session/transaction.ts";
import { ConversationImpl } from "./harness-conversation.ts";
import { createConversation, initializeConversation } from "./harness-docs.ts";
import {
  type BuiltEnv,
  buildEnv,
  conversationAgent,
  inspectHarness,
  totalUsage,
} from "./harness-queries.ts";
import { harnessClock, type Wired, wireHarness } from "./harness-wiring.ts";
import type {
  Agent,
  AgentChange,
  Conversation,
  ConversationCreateOptions,
  ConversationId,
  ConversationInit,
  ConversationRecord,
  Harness as HarnessType,
  HarnessInspection,
  HarnessOptions,
  RegistrySnapshot,
  SettledTask,
  Storage,
  Submission,
  SubmissionId,
  TaskId,
  TaskRecord,
  ToolRegistration,
} from "./types.ts";

type Host<Tool extends ToolRegistration> = ConstructorParameters<typeof ConversationImpl<Tool>>[1];
type CreateArgs<Tool extends ToolRegistration> = Parameters<Host<Tool>["create"]>;

export const SCHEDULER_INDEX_SIZES = Symbol.for("msa-durable.schedulerIndexSizes");

export class HarnessImpl<Tool extends ToolRegistration> extends SessionImpl implements HarnessType {
  readonly #options: HarnessOptions<Tool>;
  readonly #wired: Wired;
  readonly #host: Host<Tool>;

  constructor(rawStorage: Storage, options: HarnessOptions<Tool>, context: Context) {
    const clock = harnessClock(options);
    super(rawStorage, clock.now, () => options.settings?.documentRetentionMs);
    const storage = this.storage;
    this.#options = options;
    this.#wired = wireHarness({ host: this, storage, options, clock, context });
    const { tasks, submissions, views, now } = this.#wired;
    this.#host = {
      harness: this,
      storage,
      tasks,
      submissions,
      views,
      now,
      create: (target, createOptions, ctx) => this.#create(target, createOptions, ctx),
    };
  }

  resolveAgent(
    id: ConversationId,
    snapshot: RegistrySnapshot<Tool> | undefined,
    context: Context,
  ): Promise<Agent<Tool>> {
    const query = { session: this, options: this.#options, report: this.#wired.report };
    return Effect.runPromise(conversationAgent(query, id, snapshot, context));
  }

  buildEnv(id: ConversationId, context: Context): Promise<BuiltEnv> {
    return Effect.runPromise(buildEnv(this, this.#options, id, context));
  }

  openTasks(context: Context): Promise<void> {
    return this.#wired.tasks.open(context);
  }

  resume(): void {
    this.assertUsable();
    this.#wired.tasks.resume();
  }

  getTask<R>(
    id: TaskId<R>,
    context: Context,
  ): Promise<TaskRecord<JsonValue, JsonValue, R> | undefined> {
    return this.readOnLine(() => this.storage.task(id, context)) as Promise<
      TaskRecord<JsonValue, JsonValue, R> | undefined
    >;
  }

  get [SCHEDULER_INDEX_SIZES](): Wired["tasks"]["indexSizes"] {
    return this.#wired.tasks.indexSizes;
  }

  inspect(context: Context): Promise<HarnessInspection> {
    const query = { session: this, storage: this.storage };
    const snapshot = this.#options.registry.snapshot();
    return Effect.runPromise(inspectHarness(query, this.#wired.tasks, snapshot, context));
  }

  submission(id: SubmissionId, context: Context): Promise<Submission | undefined> {
    return this.#wired.submissions.get(id, context);
  }

  abortSubmission(
    id: SubmissionId,
    context: Context,
    conversationId?: ConversationId,
  ): Promise<"aborted" | "already_placed" | "settled" | "not_found"> {
    return this.#wired.submissions.abort(id, context, conversationId);
  }

  abortTask(id: TaskId, context: Context): Promise<"marked" | "terminal"> {
    return this.#wired.tasks.abort(id, context);
  }

  waitForTask<R>(id: TaskId<R>, context: Context): Promise<SettledTask<R>> {
    this.#wired.tasks.resume();
    return this.#wired.tasks.waitForTask(id, context) as Promise<SettledTask<R>>;
  }

  waitForIdle(context: Context): Promise<void> {
    this.#wired.tasks.resume();
    return this.#wired.tasks.waitForIdle(undefined, context);
  }

  usage(context: Context): ReturnType<HarnessType["usage"]> {
    return Effect.runPromise(totalUsage({ session: this, storage: this.storage }, context));
  }

  taskGraph(context: Context): ReturnType<HarnessType["taskGraph"]> {
    return this.#wired.taskGraph.state(context);
  }

  watchTaskGraph(context: Context): ReturnType<HarnessType["watchTaskGraph"]> {
    return this.#wired.taskGraph.watch(context);
  }

  root(
    context: Context,
    options?: { readonly agent?: AgentChange; readonly init?: ConversationInit },
  ): Promise<Conversation> {
    return this.#create({ kind: "root" }, options ?? {}, context);
  }

  conversation(id: ConversationId, context: Context): Promise<Conversation | undefined> {
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

  createConversation(options: ConversationCreateOptions, context: Context): Promise<Conversation> {
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
    context: Context,
  ): Promise<Conversation> {
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
    tx: Transaction,
    record: ConversationRecord,
  ): Promise<void> {
    return Effect.runPromise(initializeConversation(tx, record, this.#options.conversationCreated));
  }
}
