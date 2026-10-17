import * as Effect from "effect/Effect";

import type { CodemodeSandboxBaseOptions } from "../types.ts";
import type { CodemodeWasmModule } from "../wasm.ts";
import { errorMessage } from "./bridge.ts";
import { InlineRun } from "./inline-run.ts";
import { LaunchError, type VmLauncher } from "./launcher.ts";
import { CodemodeSandboxBase } from "./sandbox-base.ts";
import { startVm } from "./vm-session.ts";

export const DEFAULT_INTERRUPT_BUDGET = 100_000;

export const INLINE_MAX_STACK_SIZE = 256 * 1024;

export interface InlineCodemodeSandboxOptions extends CodemodeSandboxBaseOptions {
  wasm: CodemodeWasmModule | Promise<CodemodeWasmModule>;
  interruptBudget?: number;
}

export interface InlineLauncherOptions {
  wasm: CodemodeWasmModule | Promise<CodemodeWasmModule>;
  interruptBudget?: number | undefined;
}

export const loadWasm = (source: () => CodemodeWasmModule | Promise<CodemodeWasmModule>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(source()),
    catch: (cause) =>
      new LaunchError({ message: `Failed to load QuickJS: ${errorMessage(cause)}`, cause }),
  });

export function inlineLauncher(options: InlineLauncherOptions): VmLauncher {
  const interruptBudget = options.interruptBudget ?? DEFAULT_INTERRUPT_BUDGET;
  return (data, events) =>
    Effect.gen(function* () {
      const module = yield* loadWasm(() => options.wasm);
      const run = new InlineRun(data, events, interruptBudget);
      const session = yield* startVm({
        data,
        wasm: module,
        maxStackSize: INLINE_MAX_STACK_SIZE,
        interruptBudget,
        shouldInterrupt: run.shouldInterrupt,
        post: run.post,
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
