import { fauxAssistantMessage, fauxToolCall, Type } from "@msa/ai";
import type { Context } from "@msa/chord";
import {
  type AgentEvent,
  type Conversation,
  defineTask,
  defineTool,
  type Harness,
  type JoinPolicy,
  type NextTaskState,
  type Registry,
  type Storage,
  type TaskId,
  type TaskOptions,
  type TaskRuntime,
  type ToolRegistration,
  type Tx,
} from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import {
  waitFor,
  awaited,
  joinPath,
  makeTempDir,
  context,
  aborted,
  type Deferred,
  deferred,
  openTasks,
} from "./support.ts";

export type NodeInput = { name: string };

export type NodeCheckpoint = { phase: "run" } | { phase: "resume"; round: number };

export type NodeRuntime = TaskRuntime<NodeInput, NodeCheckpoint, string, object>;

export type Next = NextTaskState<NodeCheckpoint, string>;

export type Behavior = {
  run?(runtime: NodeRuntime, ctx: Context): Promise<void>;
  resume?(runtime: NodeRuntime, ctx: Context, round: number): Promise<void>;
  abort?(runtime: NodeRuntime, ctx: Context): Promise<void>;
};

export type Ending = "completed" | "failed" | "throw";

export const behaviors = new Map<string, Behavior>();

export const gates = new Map<string, Deferred<Ending>>();

export const log: string[] = [];

export function gate(name: string): Deferred<Ending> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<Ending>();
    gates.set(name, found);
  }
  return found;
}

function openImpl(name: string, ending: Ending = "completed"): void {
  gate(name).resolve(ending);
}

export const open: {
  (ending?: Ending): (name: string) => ReturnType<typeof openImpl>;
  (name: string, ending?: Ending): ReturnType<typeof openImpl>;
} = dual(
  (args) => args.length === 2 || !["completed", "failed", "throw"].includes(args[0]),
  openImpl,
);

function scriptImpl(name: string, behavior: Behavior): void {
  behaviors.set(name, behavior);
}

export const script: {
  (behavior: Behavior): (name: string) => ReturnType<typeof scriptImpl>;
  (name: string, behavior: Behavior): ReturnType<typeof scriptImpl>;
} = dual(2, scriptImpl);

function defaultRunImpl(runtime: NodeRuntime, ctx: Context, name: string): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const ending = yield* awaited(Promise.race([gate(name).promise, aborted(runtime.signal)]));
      if (ending === "throw") throw new Error(`${name} threw`);
      yield* awaited(runtime.commit(() => end(ending, name), ctx));
    }),
  );
}

export const defaultRun: {
  (ctx: Context, name: string): (runtime: NodeRuntime) => ReturnType<typeof defaultRunImpl>;
  (runtime: NodeRuntime, ctx: Context, name: string): ReturnType<typeof defaultRunImpl>;
} = dual(3, defaultRunImpl);

function endImpl(ending: "completed" | "failed", name: string): Next {
  return ending === "completed"
    ? { status: "terminal", outcome: { status: "completed", result: name } }
    : { status: "terminal", outcome: { status: "failed", error: { message: `${name} failed` } } };
}

export const end: {
  (name: string): (ending: "completed" | "failed") => ReturnType<typeof endImpl>;
  (ending: "completed" | "failed", name: string): ReturnType<typeof endImpl>;
} = dual(2, endImpl);

export const Node = defineTask<NodeInput, NodeCheckpoint, string>({
  name: "test.node",
  version: 1,
  initial: () => ({ phase: "run" }),
  phases: {
    run: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const name = task.input.name;
          log.push(`run:${name}`);
          const behavior = behaviors.get(name)?.run;
          yield* awaited(
            behavior === undefined ? defaultRun(runtime, ctx, name) : behavior(runtime, ctx),
          );
        }),
      ),
    resume: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const name = task.input.name;
          log.push(`resume:${name}`);
          const behavior = behaviors.get(name)?.resume;
          if (behavior !== undefined)
            return yield* awaited(behavior(runtime, ctx, task.state.checkpoint.round));
          yield* awaited(runtime.commit(() => end("completed", name), ctx));
        }),
      ),
  },
  abort: (task, runtime, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const name = task.input.name;
        log.push(`abort:${name}`);
        const behavior = behaviors.get(name)?.abort;
        if (behavior !== undefined) return yield* awaited(behavior(runtime, ctx));
        yield* awaited(
          runtime.commit(
            () => ({ status: "terminal", outcome: { status: "aborted", result: name } }),
            ctx,
          ),
        );
      }),
    ),
});

export const Unregistered = defineTask<NodeInput, { phase: "run" }, string>({
  name: "test.unregistered",
  version: 1,
  initial: () => ({ phase: "run" }),
  phases: { run: () => Promise.resolve() },
  abort: () => Promise.resolve(),
});

export const OWN_CONVERSATION: TaskOptions = { ownership: { kind: "conversation" } };

export function owned(owner: TaskId): TaskOptions {
  return { ownership: { kind: "task", taskId: owner } };
}

function spawnImpl(tx: Tx, owner: TaskId, name: string): Promise<TaskId<string>> {
  return tx.createTask(Node, { name }, owned(owner));
}

export const spawn: {
  (owner: TaskId, name: string): (tx: Tx) => ReturnType<typeof spawnImpl>;
  (tx: Tx, owner: TaskId, name: string): ReturnType<typeof spawnImpl>;
} = dual(3, spawnImpl);

function waitOnImpl(on: readonly TaskId[], policy: JoinPolicy, round = 1): Next {
  return { status: "waiting", checkpoint: { phase: "resume", round }, on, policy };
}

export const waitOn: {
  (policy: JoinPolicy, round?: number): (on: readonly TaskId[]) => ReturnType<typeof waitOnImpl>;
  (on: readonly TaskId[], policy: JoinPolicy, round?: number): ReturnType<typeof waitOnImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, waitOnImpl);

function startImpl(
  conversation: Conversation,
  name: string,
  options: TaskOptions = OWN_CONVERSATION,
) {
  return Promise.resolve(
    conversation.commit((tx) => tx.createTask(Node, { name }, options), context),
  );
}

export const start: {
  (
    name: string,
    options?: TaskOptions,
  ): (conversation: Conversation) => ReturnType<typeof startImpl>;
  (conversation: Conversation, name: string, options?: TaskOptions): ReturnType<typeof startImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, startImpl);

export type Opened = {
  harness: Harness;
  root: Conversation;
  registry: Registry;
  reports: unknown[];
};

export const openNodes = Effect.fn("openNodes")(function* (storage: Storage = new MemoryStorage()) {
  const opened = yield* openTasks(storage, [Node]);
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  return { ...opened, root };
});

export const state = Effect.fn("state")(function* (harness: Harness, id: TaskId) {
  return (yield* awaited(harness.getTask(id, context)))!.state;
});

function outcomeOfImpl(harness: Harness, id: TaskId): Promise<string> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return (yield* awaited(harness.waitForTask(id, context))).state.outcome.status;
    }),
  );
}

export const outcomeOf: {
  (id: TaskId): (harness: Harness) => ReturnType<typeof outcomeOfImpl>;
  (harness: Harness, id: TaskId): ReturnType<typeof outcomeOfImpl>;
} = dual(2, outcomeOfImpl);

export const until = Effect.fn("until")(function* (check: () => boolean | Promise<boolean>) {
  yield* waitFor(check);
});

export const directories = new Set<string>();

export const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-structured-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

function parentOfImpl(parent: string, children: readonly string[], policy: JoinPolicy) {
  const found = { ids: [] as TaskId<string>[], outcomes: [] as string[] };
  script(parent, {
    run: (runtime, ctx) =>
      runtime.commit(
        (tx) =>
          Effect.runPromise(
            Effect.gen(function* () {
              for (const name of children)
                found.ids.push(yield* awaited(spawn(tx, runtime.taskId, name)));
              return waitOn(found.ids, policy);
            }),
          ),
        ctx,
      ),
    resume: (runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          found.outcomes = (yield* awaited(runtime.outcomes(found.ids, ctx))).map(
            (outcome) => outcome.status,
          );
          yield* awaited(runtime.commit(() => end("completed", parent), ctx));
        }),
      ),
  });
  return found;
}

export const parentOf: {
  (
    children: readonly string[],
    policy: JoinPolicy,
  ): (parent: string) => ReturnType<typeof parentOfImpl>;
  (
    parent: string,
    children: readonly string[],
    policy: JoinPolicy,
  ): ReturnType<typeof parentOfImpl>;
} = dual(3, parentOfImpl);

export function blockingTool(name: string): {
  started: Promise<void>;
  registration: ToolRegistration;
} {
  const started = deferred();
  return {
    started: started.promise,
    registration: defineTool({
      name,
      description: `The ${name} tool`,
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: (_args, api, callContext) => {
        api.output("partial");
        started.resolve();
        return Promise.resolve(aborted(callContext.abortSignal!));
      },
    }),
  };
}

export function toolCalls(...ids: readonly [string, string][]) {
  return fauxAssistantMessage(
    ids.map(([name, id]) => fauxToolCall(name, {}, { id })),
    { stopReason: "toolUse" },
  );
}

function spawnAndFinishImpl(name: string, child: string): { id?: TaskId } {
  const found: { id?: TaskId } = {};
  script(name, {
    run: (runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    found.id = yield* awaited(spawn(tx, runtime.taskId, child));
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  return found;
}

export const spawnAndFinish: {
  (child: string): (name: string) => ReturnType<typeof spawnAndFinishImpl>;
  (name: string, child: string): ReturnType<typeof spawnAndFinishImpl>;
} = dual(2, spawnAndFinishImpl);

export const listen = Effect.fn("listen")(function* (harness: Harness, conversation: Conversation) {
  const stream = yield* awaited(watchEvents(harness, conversation.id, context));
  const events: AgentEvent[] = [];
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { stream, events };
});

export function labels(events: readonly AgentEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type === "tool_execution_end")
      return [`end:${event.toolCallId}:${event.entry !== undefined}`];
    if (event.type === "message_end") {
      const message = event.entry.model?.[0];
      return [
        message?.role === "toolResult"
          ? `result:${message.toolCallId}`
          : `message:${message?.role}`,
      ];
    }
    return [];
  });
}
