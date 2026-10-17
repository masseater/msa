import { DurableObject } from "cloudflare:workers";
import quickjsWasmImport from "quickjs-wasi/quickjs.wasm";

import {
  DEFAULT_INTERRUPT_BUDGET,
  InlineCodemodeSandbox,
  type InlineCodemodeSandboxOptions,
} from "./runtime/inline.ts";
import {
  type CodemodeRemoteExchange,
  type CodemodeRemoteRequest,
  serveCodemodeRemote,
} from "./runtime/remote.ts";
import type { CodemodeWasmModule } from "./types.ts";

export * from "./portable.ts";

const quickjsWasm = quickjsWasmImport as unknown as CodemodeWasmModule;

export const DEFAULT_REMOTE_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;

export const cloudflareQuickJSWasm: CodemodeWasmModule = quickjsWasm;

export function createInlineCodemodeSandbox(
  options: Omit<InlineCodemodeSandboxOptions, "wasm"> = {},
) {
  return new InlineCodemodeSandbox({ ...options, wasm: quickjsWasm });
}

export class CodemodeSandboxDurableObject<Env = unknown> extends DurableObject<Env> {
  protected maxInterruptBudget: number = DEFAULT_INTERRUPT_BUDGET;
  protected maxMemoryLimitBytes: number = DEFAULT_REMOTE_MEMORY_LIMIT_BYTES;

  execute(request: CodemodeRemoteRequest, exchange: CodemodeRemoteExchange): Promise<void> {
    return serveCodemodeRemote(request, exchange, {
      wasm: quickjsWasm,
      maxInterruptBudget: this.maxInterruptBudget,
      maxMemoryLimitBytes: this.maxMemoryLimitBytes,
    });
  }
}
