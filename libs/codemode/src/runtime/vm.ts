import * as Effect from "effect/Effect";
import { Intrinsics, MAX_STACK_SIZE, QuickJS } from "quickjs-wasi";

import type { CodemodeWasmModule } from "../wasm.ts";
import { errorMessage } from "./bridge.ts";
import { LaunchError } from "./errors/launch-error.ts";
import type { VmStartData, WorkerToHostMessage } from "./protocol.ts";
import { VmController, type VmSession } from "./vm-session.ts";
import { deterministicWasi, discardOutput, type VirtualClock } from "./vm-wasi.ts";

export type { VmSession } from "./vm-session.ts";

export interface StartVmOptions {
  data: VmStartData;
  wasm: CodemodeWasmModule;
  maxStackSize?: number;
  interruptBudget?: number;
  post(message: WorkerToHostMessage): void;
  shouldInterrupt(): boolean;
}

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
    catch: (cause) => new LaunchError({ message: errorMessage(cause), cause }),
  });

export const startVm = Effect.fn("startVm")(function* (options: StartVmOptions) {
  const maxStackSize = options.maxStackSize ?? MAX_STACK_SIZE;
  const clock = virtualClock(options.data);
  const vm = yield* createVm(options, clock, maxStackSize);
  if (clock !== undefined) clock.creating = false;
  const controller = new VmController(
    vm,
    {
      data: options.data,
      maxStackSize,
      interruptBudget: options.interruptBudget,
      post: options.post,
      shouldInterrupt: options.shouldInterrupt,
    },
    clock,
  );
  const session: VmSession = controller.boot();
  return session;
});
