import type { Context } from "@msa/chord";
import {
  type Conversation,
  type Harness,
  type JoinPolicy,
  type Storage,
  type TaskId,
  type TaskOptions,
  type Tx,
  defineTask,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type harnessStructuredSupportTypes from "./harness-structured-support.types.ts";
import support from "./support.ts";

const { aborted, awaited, context, deferred, joinPath, makeTempDir, openTasks, waitFor } = support;

const behaviors = new Map<string, harnessStructuredSupportTypes.Behavior>();

const gates = new Map<string, PromiseWithResolvers<harnessStructuredSupportTypes.Ending>>();

const log: string[] = [];

function gate(name: string): PromiseWithResolvers<harnessStructuredSupportTypes.Ending> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<harnessStructuredSupportTypes.Ending>();
    gates.set(name, found);
  }
  return found;
}

function openImpl(name: string, ending: harnessStructuredSupportTypes.Ending = "completed"): void {
  gate(name).resolve(ending);
}

const open: {
  (ending?: harnessStructuredSupportTypes.Ending): (name: string) => ReturnType<typeof openImpl>;
  (name: string, ending?: harnessStructuredSupportTypes.Ending): ReturnType<typeof openImpl>;
} = dual(
  (args) => args.length === 2 || !["completed", "failed", "throw"].includes(args[0]),
  openImpl,
);

function scriptImpl(name: string, behavior: harnessStructuredSupportTypes.Behavior): void {
  behaviors.set(name, behavior);
}

const script: {
  (
    behavior: harnessStructuredSupportTypes.Behavior,
  ): (name: string) => ReturnType<typeof scriptImpl>;
  (name: string, behavior: harnessStructuredSupportTypes.Behavior): ReturnType<typeof scriptImpl>;
} = dual(2, scriptImpl);

function defaultRunImpl(
  runtime: harnessStructuredSupportTypes.NodeRuntime,
  ctx: Context,
  name: string,
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const ending = yield* awaited(Promise.race([gate(name).promise, aborted(runtime.signal)]));
      if (ending === "throw") throw new Error(`${name} threw`);
      yield* awaited(runtime.commit(() => end(ending, name), ctx));
    }),
  );
}

const defaultRun: {
  (
    ctx: Context,
    name: string,
  ): (runtime: harnessStructuredSupportTypes.NodeRuntime) => ReturnType<typeof defaultRunImpl>;
  (
    runtime: harnessStructuredSupportTypes.NodeRuntime,
    ctx: Context,
    name: string,
  ): ReturnType<typeof defaultRunImpl>;
} = dual(3, defaultRunImpl);

function endImpl(ending: "completed" | "failed", name: string): harnessStructuredSupportTypes.Next {
  return ending === "completed"
    ? { outcome: { result: name, status: "completed" }, status: "terminal" }
    : { outcome: { error: { message: `${name} failed` }, status: "failed" }, status: "terminal" };
}

const end: {
  (name: string): (ending: "completed" | "failed") => ReturnType<typeof endImpl>;
  (ending: "completed" | "failed", name: string): ReturnType<typeof endImpl>;
} = dual(2, endImpl);

const Node = defineTask<
  harnessStructuredSupportTypes.NodeInput,
  harnessStructuredSupportTypes.NodeCheckpoint,
  string
>({
  abort: (task, runtime, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const name = task.input.name;
        log.push(`abort:${name}`);
        const behavior = behaviors.get(name)?.abort;
        if (behavior !== undefined) return yield* awaited(behavior(runtime, ctx));
        yield* awaited(
          runtime.commit(
            () => ({ outcome: { result: name, status: "aborted" }, status: "terminal" }),
            ctx,
          ),
        );
      }),
    ),
  initial: () => ({ phase: "run" }),
  name: "test.node",
  phases: {
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
  },
  version: 1,
});

const Unregistered = defineTask<harnessStructuredSupportTypes.NodeInput, { phase: "run" }, string>({
  abort: () => Promise.resolve(),
  initial: () => ({ phase: "run" }),
  name: "test.unregistered",
  phases: { run: () => Promise.resolve() },
  version: 1,
});

const OWN_CONVERSATION: TaskOptions = { ownership: { kind: "conversation" } };

function owned(owner: TaskId): TaskOptions {
  return { ownership: { kind: "task", taskId: owner } };
}

function spawnImpl(tx: Tx, owner: TaskId, name: string): Promise<TaskId<string>> {
  return tx.createTask(Node, { name }, owned(owner));
}

const spawn: {
  (owner: TaskId, name: string): (tx: Tx) => ReturnType<typeof spawnImpl>;
  (tx: Tx, owner: TaskId, name: string): ReturnType<typeof spawnImpl>;
} = dual(3, spawnImpl);

function waitOnImpl(
  on: readonly TaskId[],
  policy: JoinPolicy,
  round = 1,
): harnessStructuredSupportTypes.Next {
  return { checkpoint: { phase: "resume", round }, on, policy, status: "waiting" };
}

const waitOn: {
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

const start: {
  (
    name: string,
    options?: TaskOptions,
  ): (conversation: Conversation) => ReturnType<typeof startImpl>;
  (conversation: Conversation, name: string, options?: TaskOptions): ReturnType<typeof startImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, startImpl);

const openNodes = Effect.fn("openNodes")(function* (storage: Storage = new MemoryStorage()) {
  const opened = yield* openTasks(storage, [Node]);
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  return { ...opened, root };
});

const state = Effect.fn("state")(function* (harness: Harness, id: TaskId) {
  return (yield* awaited(harness.getTask(id, context)))!.state;
});

function outcomeOfImpl(harness: Harness, id: TaskId): Promise<string> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return (yield* awaited(harness.waitForTask(id, context))).state.outcome.status;
    }),
  );
}

const outcomeOf: {
  (id: TaskId): (harness: Harness) => ReturnType<typeof outcomeOfImpl>;
  (harness: Harness, id: TaskId): ReturnType<typeof outcomeOfImpl>;
} = dual(2, outcomeOfImpl);

const until = Effect.fn("until")(function* (check: Parameters<typeof waitFor>[0]) {
  yield* waitFor(check);
});

const directories = new Set<string>();

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-structured-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

function parentOfImpl(parent: string, children: readonly string[], policy: JoinPolicy) {
  const found = { ids: [] as TaskId<string>[], outcomes: [] as string[] };
  script(parent, {
    resume: (runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          found.outcomes = (yield* awaited(runtime.outcomes(found.ids, ctx))).map(
            (outcome) => outcome.status,
          );
          yield* awaited(runtime.commit(() => end("completed", parent), ctx));
        }),
      ),
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
  });
  return found;
}

const parentOf: {
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

const harnessStructuredSupport = {
  Node,
  OWN_CONVERSATION,
  Unregistered,
  behaviors,
  defaultRun,
  directories,
  end,
  gate,
  gates,
  log,
  open,
  openNodes,
  outcomeOf,
  owned,
  parentOf,
  script,
  spawn,
  sqlitePath,
  start,
  state,
  until,
  waitOn,
};

export default harnessStructuredSupport;
