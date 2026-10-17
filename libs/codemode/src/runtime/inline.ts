import * as Effect from "effect/Effect";
import { Intrinsics, MAX_STACK_SIZE, QuickJS } from "quickjs-wasi";

import type { CodemodeWasmModule } from "../types.ts";
import { RuntimeError } from "./bridge.ts";
import { errorMessage } from "./prelude-source.ts";
import type {
  InlineCodemodeSandboxOptions,
  InlineLauncherOptions,
  StartVmOptions,
  VmEvents,
  VmLauncher,
  VmStartData,
  WorkerToHostMessage,
} from "./protocol.ts";
import { CodemodeSandboxBase } from "./sandbox-base.ts";
import { bootVm, deterministicWasi, discardOutput, type VirtualClock } from "./vm-session.ts";

export type { InlineCodemodeSandboxOptions } from "./protocol.ts";

export const DEFAULT_INTERRUPT_BUDGET = 100_000;

const INLINE_MAX_STACK_SIZE = 256 * 1024;

const launchError = (message: string, cause: unknown) =>
  new RuntimeError({ reason: "launch", message, cause });

const virtualClock = (data: VmStartData): VirtualClock | undefined =>
  data.deterministic === undefined
    ? undefined
    : {
        creating: true,
        startedAt: data.deterministic.startedAt,
        now: data.deterministic.startedAt,
        seed: data.deterministic.seed >>> 0,
      };

const createVm = (options: StartVmOptions, clock: VirtualClock | undefined, maxStackSize: number) =>
  Effect.tryPromise({
    try: () =>
      QuickJS.create({
        wasm: options.wasm,
        memoryLimit: options.data.memoryLimitBytes,
        maxStackSize,
        interruptHandler: options.shouldInterrupt,
        wasi: clock === undefined ? discardOutput : deterministicWasi(clock),
        ...(clock === undefined
          ? {}
          : { timezoneOffset: 0, intrinsics: Intrinsics.ALL & ~Intrinsics.WEAK_REF }),
      }),
    catch: (cause) => launchError(errorMessage(cause), cause),
  });

export const startVm = Effect.fn("startVm")(function* (options: StartVmOptions) {
  const maxStackSize = options.maxStackSize ?? MAX_STACK_SIZE;
  const clock = virtualClock(options.data);
  const vm = yield* createVm(options, clock, maxStackSize);
  if (clock !== undefined) clock.creating = false;
  const { data, interruptBudget, post, shouldInterrupt } = options;
  return bootVm(vm, { data, maxStackSize, interruptBudget, post, shouldInterrupt }, clock);
});

export const loadWasm = (source: () => CodemodeWasmModule | Promise<CodemodeWasmModule>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(source()),
    catch: (cause) => launchError(`Failed to load QuickJS: ${errorMessage(cause)}`, cause),
  });

interface InlineRun {
  readonly data: VmStartData;
  readonly events: VmEvents;
  readonly interruptBudget: number;
  readonly deadline: number | undefined;
  stopped: boolean;
  settled: boolean;
  polls: number;
  exhausted: boolean;
  timedOut: boolean;
}

const shouldInterrupt = (run: InlineRun): boolean => {
  if (run.stopped || run.settled || run.exhausted || run.timedOut) return true;
  if (run.deadline !== undefined && performance.now() >= run.deadline) {
    run.timedOut = true;
    return true;
  }
  if (++run.polls <= run.interruptBudget) return false;
  run.exhausted = true;
  return true;
};

const dispatch = (run: InlineRun, message: WorkerToHostMessage, terminal: boolean): void => {
  if (run.stopped) return;
  if ((run.exhausted || run.timedOut) && terminal) {
    run.events.failure({
      kind: "timeout",
      message: run.timedOut
        ? `Execution timed out after ${run.data.timeoutMs} ms`
        : `Execution exceeded its interrupt budget of ${run.interruptBudget}`,
    });
    return;
  }
  run.events.message(message);
};

const postFrom = (run: InlineRun, message: WorkerToHostMessage): void => {
  const terminal = message.type === "done" || message.type === "crash";
  if (terminal && run.settled) return;
  if (terminal) run.settled = true;
  queueMicrotask(() => dispatch(run, message, terminal));
};

const newRun = (data: VmStartData, events: VmEvents, interruptBudget: number): InlineRun => ({
  data,
  events,
  interruptBudget,
  deadline: data.timeoutMs === undefined ? undefined : performance.now() + data.timeoutMs,
  stopped: false,
  settled: false,
  polls: 0,
  exhausted: false,
  timedOut: false,
});

export function inlineLauncher(options: InlineLauncherOptions): VmLauncher {
  const interruptBudget = options.interruptBudget ?? DEFAULT_INTERRUPT_BUDGET;
  return (data, events) =>
    Effect.gen(function* () {
      const module = yield* loadWasm(() => options.wasm);
      const run = newRun(data, events, interruptBudget);
      const session = yield* startVm({
        data,
        wasm: module,
        maxStackSize: INLINE_MAX_STACK_SIZE,
        interruptBudget,
        shouldInterrupt: () => shouldInterrupt(run),
        post: (message) => postFrom(run, message),
      });
      return {
        post: (message) => {
          if (!run.stopped) session.deliver(message);
        },
        stop: Effect.sync(() => {
          if (run.stopped) return;
          run.stopped = true;
          session.dispose();
        }),
      };
    });
}

export class InlineCodemodeSandbox extends CodemodeSandboxBase {
  constructor(options: InlineCodemodeSandboxOptions) {
    super(
      options,
      inlineLauncher({ wasm: options.wasm, interruptBudget: options.interruptBudget }),
    );
  }
}
