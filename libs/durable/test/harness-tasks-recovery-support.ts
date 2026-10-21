import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type harnessTasksRecoverySupportTypes from "./harness-tasks-recovery-support.types.ts";
import support from "./support.ts";

const { defineTask } = durable;
const { MemoryStorage } = memory;
const { createRegistry } = harnessModule;

const {
  abortedWith,
  addTask,
  awaited,
  completed,
  context,
  eventually,
  flush,
  joinPath,
  makeTempDir,
  openTasks,
} = support;

const directories = new Set<string>();

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-tasks-");
  directories.add(directory);
  return joinPath(directory, "session.sqlite");
});

const createIn = Effect.fn("createIn")(function* <S extends { phase: string }, R>(
  harness: harnessTasksRecoverySupportTypes.OpenHarness,
  task: durableTypes.Task<null, S, R, object>,
) {
  const root = yield* awaited(harness.root(context));
  return yield* awaited(
    root.commit(
      (tx) => tx.createTask(task, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
});

function versionedImpl(
  version: number,
  result: string,
  migrate?: (
    input: chordTypes.JsonValue,
    checkpoint: chordTypes.JsonValue,
    fromVersion: number,
  ) => { input: null; checkpoint: harnessTasksRecoverySupportTypes.Step },
) {
  return defineTask<null, harnessTasksRecoverySupportTypes.Step, chordTypes.JsonValue>({
    abort: (_task, runtime, ctx) => runtime.commit(() => abortedWith(result), ctx),
    initial: () => ({ phase: "run" }),
    name: "test.versioned",
    phases: { run: (_task, runtime, ctx) => runtime.commit(() => completed(result), ctx) },
    version,
    ...(migrate === undefined ? {} : { migrate }),
  });
}

const versioned: {
  (
    result: string,
    migrate?: (
      input: chordTypes.JsonValue,
      checkpoint: chordTypes.JsonValue,
      fromVersion: number,
    ) => { input: null; checkpoint: harnessTasksRecoverySupportTypes.Step },
  ): (version: number) => ReturnType<typeof versionedImpl>;
  (
    version: number,
    result: string,
    migrate?: (
      input: chordTypes.JsonValue,
      checkpoint: chordTypes.JsonValue,
      fromVersion: number,
    ) => { input: null; checkpoint: harnessTasksRecoverySupportTypes.Step },
  ): ReturnType<typeof versionedImpl>;
} = dual((args) => typeof args[0] === "number", versionedImpl);

const handoverPhase =
  (step: {
    readonly gates: harnessTasksRecoverySupportTypes.Gates | undefined;
    readonly label: string;
    readonly log: string[];
    readonly next: harnessTasksRecoverySupportTypes.Handover;
    readonly phase: "a" | "b";
  }) =>
  (
    _task: unknown,
    runtime: durableTypes.TaskRuntime<
      null,
      harnessTasksRecoverySupportTypes.Handover,
      null,
      object
    >,
    ctx: chordTypes.Context,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        step.log.push(`${step.label}:${step.phase} start`);
        yield* awaited(step.gates?.[step.phase]);
        yield* awaited(runtime.commit(() => ({ checkpoint: step.next, status: "running" }), ctx));
        yield* flush;
        step.gates?.onEnd?.();
        step.log.push(`${step.label}:${step.phase} end`);
      }),
    );

function handoverTaskImpl(
  label: string,
  version: number,
  log: string[],
  options: {
    readonly gates?: harnessTasksRecoverySupportTypes.Gates;
    readonly migrate?: () => { input: null; checkpoint: harnessTasksRecoverySupportTypes.Handover };
  } = {},
) {
  const advance = (phase: "a" | "b", next: harnessTasksRecoverySupportTypes.Handover) =>
    handoverPhase({ gates: options.gates, label, log, next, phase });
  return defineTask<null, harnessTasksRecoverySupportTypes.Handover, null>({
    abort: (_task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          log.push(`${label}:abort`);
          yield* awaited(runtime.commit(() => abortedWith(label), ctx));
        }),
      ),
    initial: () => ({ phase: "a" }),
    name: "test.handover",
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
    version,
    ...(options.migrate === undefined ? {} : { migrate: options.migrate }),
  });
}

const handoverTask: {
  (
    version: number,
    log: string[],
    options?: {
      readonly gates?: harnessTasksRecoverySupportTypes.Gates;
      readonly migrate?: () => {
        input: null;
        checkpoint: harnessTasksRecoverySupportTypes.Handover;
      };
    },
  ): (label: string) => ReturnType<typeof handoverTaskImpl>;
  (
    label: string,
    version: number,
    log: string[],
    options?: {
      readonly gates?: harnessTasksRecoverySupportTypes.Gates;
      readonly migrate?: () => {
        input: null;
        checkpoint: harnessTasksRecoverySupportTypes.Handover;
      };
    },
  ): ReturnType<typeof handoverTaskImpl>;
} = dual((args) => typeof args[0] === "string", handoverTaskImpl);

const startHandover = Effect.fn("startHandover")(function* (
  log: string[],
  gates: harnessTasksRecoverySupportTypes.Gates,
  storage = new MemoryStorage(),
) {
  const registry = createRegistry();
  const old = addTask(registry, handoverTask("old", 1, log, { gates }));
  const opened = yield* openTasks(storage, [], { registry });
  const id = yield* createIn(opened.harness, handoverTask("old", 1, log));
  opened.harness.resume();
  yield* eventually(() => log.length === 1);
  return { ...opened, id, old };
});

const harnessTasksRecoverySupport = {
  createIn,
  directories,
  handoverTask,
  sqlitePath,
  startHandover,
  versioned,
};

export default harnessTasksRecoverySupport;
