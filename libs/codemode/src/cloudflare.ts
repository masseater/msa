import { DurableObject } from "cloudflare:workers";
import quickjsWasmImport from "quickjs-wasi/quickjs.wasm";

import bridge from "./runtime/bridge.ts";
import inline from "./runtime/inline.ts";
import type inlineTypes from "./runtime/inline.types.ts";
import preludeSource from "./runtime/prelude-source.ts";
import remoteModule from "./runtime/remote.ts";
import type remoteTypes from "./runtime/remote.types.ts";
import sandboxBase from "./runtime/sandbox-base.ts";
import type typesModule from "./types.ts";

const { DEFAULT_INTERRUPT_BUDGET, InlineCodemodeSandbox } = inline;
const { serveCodemodeRemote } = remoteModule;

const quickjsWasm = quickjsWasmImport as unknown as typesModule.CodemodeWasmModule;

const DEFAULT_REMOTE_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;

const cloudflareQuickJSWasm: typesModule.CodemodeWasmModule = quickjsWasm;

function createInlineCodemodeSandbox(
  options: Omit<inlineTypes.InlineCodemodeSandboxOptions, "wasm"> = {},
) {
  return new InlineCodemodeSandbox({ ...options, wasm: quickjsWasm });
}

class CodemodeSandboxDurableObject<Env = unknown> extends DurableObject<Env> {
  protected maxInterruptBudget: number = DEFAULT_INTERRUPT_BUDGET;
  protected maxMemoryLimitBytes: number = DEFAULT_REMOTE_MEMORY_LIMIT_BYTES;

  execute(
    request: remoteTypes.CodemodeRemoteRequest,
    exchange: remoteTypes.CodemodeRemoteExchange,
  ): Promise<void> {
    return serveCodemodeRemote(request, exchange, {
      maxInterruptBudget: this.maxInterruptBudget,
      maxMemoryLimitBytes: this.maxMemoryLimitBytes,
      wasm: quickjsWasm,
    });
  }
}

const cloudflare = {
  CodemodeSandboxBase: sandboxBase.CodemodeSandboxBase,
  CodemodeSandboxDurableObject,
  DEFAULT_INTERRUPT_BUDGET: inline.DEFAULT_INTERRUPT_BUDGET,
  DEFAULT_REMOTE_MEMORY_LIMIT_BYTES,
  InlineCodemodeSandbox: inline.InlineCodemodeSandbox,
  MAX_OUTPUT_CHARS: preludeSource.MAX_OUTPUT_CHARS,
  MAX_OUTPUT_ITEMS: preludeSource.MAX_OUTPUT_ITEMS,
  MAX_STORE_TOTAL_CHARS: preludeSource.MAX_STORE_TOTAL_CHARS,
  MAX_STORE_VALUE_CHARS: preludeSource.MAX_STORE_VALUE_CHARS,
  RemoteCodemodeSandbox: remoteModule.RemoteCodemodeSandbox,
  cloudflareQuickJSWasm,
  createInlineCodemodeSandbox,
  serveCodemodeRemote: remoteModule.serveCodemodeRemote,
  toCodemodeIdentifier: bridge.toCodemodeIdentifier,
};

export default cloudflare;
