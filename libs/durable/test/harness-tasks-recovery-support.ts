import type { Context, JsonValue } from "@msa/chord";
import { defineTask, type Task, type TaskRuntime } from "@msa/durable";
import { createRegistry } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { addTask } from "./harness-support.ts";
import { joinPath, makeTempDir } from "./platform-support.ts";
import { context, flush } from "./session-support.ts";
import { abortedWith, completed, eventually, openTasks } from "./task-support.ts";

export const directories = new Set<string>();

export const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-tasks-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

export type OpenHarness = Effect.Success<ReturnType<typeof openTasks>>["harness"];

export const createIn = Effect.fn("createIn")(function* <S extends { phase: string }, R>(
  harness: OpenHarness,
  task: Task<null, S, R, object>,
) {
  const root = yield* awaited(harness.root(context));
  return yield* awaited(
    root.commit(
      (tx) => tx.createTask(task, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
});

export type Step = { phase: "run" };

export function versioned(
  version: number,
  result: string,
  migrate?: (
    input: JsonValue,
    checkpoint: JsonValue,
    fromVersion: number,
  ) => { input: null; checkpoint: Step },
) {
  return defineTask<null, Step, JsonValue>({
    name: "test.versioned",
    version,
    initial: () => ({ phase: "run" }),
    phases: { run: (_task, runtime, ctx) => runtime.commit(() => completed(result), ctx) },
    abort: (_task, runtime, ctx) => runtime.commit(() => abortedWith(result), ctx),
    ...(migrate === undefined ? {} : { migrate }),
  });
}

export type Handover = { phase: "a" } | { phase: "b" } | { phase: "c" };

export type Gates = {
  readonly a?: Promise<void>;
  readonly b?: Promise<void>;
  readonly onEnd?: () => void;
};

export function handoverTask(
  label: string,
  version: number,
  log: string[],
  options: {
    readonly gates?: Gates;
    readonly migrate?: () => { input: null; checkpoint: Handover };
  } = {},
) {
  const advance =
    (phase: "a" | "b", next: Handover) =>
    (_task: unknown, runtime: TaskRuntime<null, Handover, null, object>, ctx: Context) =>
      Effect.runPromise(
        Effect.gen(function* () {
          log.push(`${label}:${phase} start`);
          yield* awaited(options.gates?.[phase]);
          yield* awaited(runtime.commit(() => ({ status: "running", checkpoint: next }), ctx));
          yield* flush;
          options.gates?.onEnd?.();
          log.push(`${label}:${phase} end`);
        }),
      );
  return defineTask<null, Handover, null>({
    name: "test.handover",
    version,
    initial: () => ({ phase: "a" }),
    phases: {
      a: advance("a", { phase: "b" }),
      b: advance("b", { phase: "c" }),
      c: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            log.push(`${label}:c`);
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: (_task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          log.push(`${label}:abort`);
          yield* awaited(runtime.commit(() => abortedWith(label), ctx));
        }),
      ),
    ...(options.migrate === undefined ? {} : { migrate: options.migrate }),
  });
}

export const startHandover = Effect.fn("startHandover")(function* (
  log: string[],
  gates: Gates,
  storage = new MemoryStorage(),
) {
  const registry = createRegistry();
  const old = addTask(registry, handoverTask("old", 1, log, { gates }));
  const opened = yield* openTasks(storage, [], { registry });
  const id = yield* createIn(opened.harness, handoverTask("old", 1, log));
  opened.harness.resume();
  yield* eventually(() => log.length === 1);
  return { ...opened, old, id };
});
