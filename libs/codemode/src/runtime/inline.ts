import * as Effect from "effect/Effect";
import { Intrinsics, MAX_STACK_SIZE, QuickJS } from "quickjs-wasi";

import type typesModule from "../types.ts";
import bridge from "./bridge.ts";
import InlineCodemodeSandbox from "./inline-codemode-sandbox.ts";
import preludeSource from "./prelude-source.ts";
import type protocolTypes from "./protocol.ts";
import vmSession from "./vm-session.ts";
import type vmSessionTypes from "./vm-session.types.ts";

const { RuntimeError } = bridge;
const { errorMessage } = preludeSource;
const { bootVm, deterministicWasi, discardOutput } = vmSession;

const DEFAULT_INTERRUPT_BUDGET = 100_000;

const INLINE_MAX_STACK_SIZE = 256 * 1024;

const launchError = (message: string, cause: unknown) =>
  RuntimeError.make({ cause, message, reason: "launch" });

const virtualClock = (data: protocolTypes.VmStartData): vmSessionTypes.VirtualClock | undefined =>
  data.deterministic === undefined
    ? undefined
    : {
        creating: true,
        now: data.deterministic.startedAt,
        seed: data.deterministic.seed >>> 0,
        startedAt: data.deterministic.startedAt,
      };

const createVm = (
  options: protocolTypes.StartVmOptions,
  clock: vmSessionTypes.VirtualClock | undefined,
  maxStackSize: number,
) =>
  Effect.tryPromise({
    catch: (cause) => launchError(errorMessage(cause), cause),
    try: () =>
      QuickJS.create({
        interruptHandler: options.shouldInterrupt,
        maxStackSize,
        memoryLimit: options.data.memoryLimitBytes,
        wasi: clock === undefined ? discardOutput : deterministicWasi(clock),
        wasm: options.wasm,
        ...(clock === undefined
          ? {}
          : { intrinsics: Intrinsics.ALL & ~Intrinsics.WEAK_REF, timezoneOffset: 0 }),
      }),
  });

const startVm = Effect.fn("startVm")(function* (options: protocolTypes.StartVmOptions) {
  const maxStackSize = options.maxStackSize ?? MAX_STACK_SIZE;
  const clock = virtualClock(options.data);
  const vm = yield* createVm(options, clock, maxStackSize);
  if (clock !== undefined) clock.creating = false;
  const { data, interruptBudget, post, shouldInterrupt } = options;
  return bootVm(vm, { data, interruptBudget, maxStackSize, post, shouldInterrupt }, clock);
});

const loadWasm = (
  source: () => typesModule.CodemodeWasmModule | Promise<typesModule.CodemodeWasmModule>,
) =>
  Effect.tryPromise({
    catch: (cause) => launchError(`Failed to load QuickJS: ${errorMessage(cause)}`, cause),
    try: () => Promise.resolve(source()),
  });

interface InlineRun {
  readonly data: protocolTypes.VmStartData;
  readonly events: protocolTypes.VmEvents;
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

const dispatch = (
  run: InlineRun,
  message: protocolTypes.WorkerToHostMessage,
  terminal: boolean,
): void => {
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

const postFrom = (run: InlineRun, message: protocolTypes.WorkerToHostMessage): void => {
  const terminal = message.type === "done" || message.type === "crash";
  if (terminal && run.settled) return;
  if (terminal) run.settled = true;
  queueMicrotask(() => dispatch(run, message, terminal));
};

const newRun = (
  data: protocolTypes.VmStartData,
  events: protocolTypes.VmEvents,
  interruptBudget: number,
): InlineRun => ({
  data,
  deadline: data.timeoutMs === undefined ? undefined : performance.now() + data.timeoutMs,
  events,
  exhausted: false,
  interruptBudget,
  polls: 0,
  settled: false,
  stopped: false,
  timedOut: false,
});

function inlineLauncher(options: protocolTypes.InlineLauncherOptions): protocolTypes.VmLauncher {
  const interruptBudget = options.interruptBudget ?? DEFAULT_INTERRUPT_BUDGET;
  return (data, events) =>
    Effect.gen(function* () {
      const module = yield* loadWasm(() => options.wasm);
      const run = newRun(data, events, interruptBudget);
      const session = yield* startVm({
        data,
        interruptBudget,
        maxStackSize: INLINE_MAX_STACK_SIZE,
        post: (message) => postFrom(run, message),
        shouldInterrupt: () => shouldInterrupt(run),
        wasm: module,
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

const inline = {
  DEFAULT_INTERRUPT_BUDGET,
  InlineCodemodeSandbox,
  inlineLauncher,
  loadWasm,
  startVm,
};

export default inline;
