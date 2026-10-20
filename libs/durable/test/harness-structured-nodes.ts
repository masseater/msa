import type { Context } from "@msa/chord";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type harnessStructuredSupportTypes from "./harness-structured-support.types.ts";
import support from "./support.ts";

const { defineTask } = durable;

const { aborted, awaited, context, deferred } = support;

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

function owned(owner: durableTypes.TaskId): durableTypes.TaskOptions {
  return { ownership: { kind: "task", taskId: owner } };
}

function spawnImpl(
  tx: durableTypes.Tx,
  owner: durableTypes.TaskId,
  name: string,
): Promise<durableTypes.TaskId<string>> {
  return tx.createTask(Node, { name }, owned(owner));
}

const spawn: {
  (owner: durableTypes.TaskId, name: string): (tx: durableTypes.Tx) => ReturnType<typeof spawnImpl>;
  (tx: durableTypes.Tx, owner: durableTypes.TaskId, name: string): ReturnType<typeof spawnImpl>;
} = dual(3, spawnImpl);

function waitOnImpl(
  on: readonly durableTypes.TaskId[],
  policy: durableTypes.JoinPolicy,
  round = 1,
): harnessStructuredSupportTypes.Next {
  return { checkpoint: { phase: "resume", round }, on, policy, status: "waiting" };
}

const waitOn: {
  (
    policy: durableTypes.JoinPolicy,
    round?: number,
  ): (on: readonly durableTypes.TaskId[]) => ReturnType<typeof waitOnImpl>;
  (
    on: readonly durableTypes.TaskId[],
    policy: durableTypes.JoinPolicy,
    round?: number,
  ): ReturnType<typeof waitOnImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, waitOnImpl);

const state = Effect.fn("state")(function* (
  harness: durableTypes.Harness,
  id: durableTypes.TaskId,
) {
  return (yield* awaited(harness.getTask(id, context)))!.state;
});

function parentOfImpl(
  parent: string,
  children: readonly string[],
  policy: durableTypes.JoinPolicy,
) {
  const found = { ids: [] as durableTypes.TaskId<string>[], outcomes: [] as string[] };
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
    policy: durableTypes.JoinPolicy,
  ): (parent: string) => ReturnType<typeof parentOfImpl>;
  (
    parent: string,
    children: readonly string[],
    policy: durableTypes.JoinPolicy,
  ): ReturnType<typeof parentOfImpl>;
} = dual(3, parentOfImpl);

const harnessStructuredNodes = {
  Node,
  behaviors,
  defaultRun,
  end,
  gate,
  gates,
  log,
  owned,
  parentOf,
  script,
  spawn,
  state,
  waitOn,
};

export default harnessStructuredNodes;
