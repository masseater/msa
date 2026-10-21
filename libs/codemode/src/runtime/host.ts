import { createRequire } from "node:module";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import type typesModule from "../types.ts";
import CodemodeSandbox from "./codemode-sandbox.ts";

const runtime = ManagedRuntime.make(NodeFileSystem.layer);

const readFileBytes = (path: string): Promise<Uint8Array> =>
  runtime.runPromise(
    FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
      Effect.mapError((error) => error.cause ?? error),
    ),
  );

interface WebAssemblyGlobal {
  compile(bytes: Uint8Array): Promise<typesModule.CodemodeWasmModule>;
}

const modules = new Map<string, Promise<typesModule.CodemodeWasmModule>>();

function loadQuickJSWasm(path?: string): Promise<typesModule.CodemodeWasmModule> {
  const resolved = path ?? createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm");
  let module = modules.get(resolved);
  if (module === undefined) {
    const { WebAssembly } = globalThis as unknown as { WebAssembly: WebAssemblyGlobal };
    module = readFileBytes(resolved)
      .then((bytes) => WebAssembly.compile(bytes))
      .catch((error: unknown) => {
        modules.delete(resolved);
        throw error;
      });
    modules.set(resolved, module);
  }
  return module;
}

const host = {
  CodemodeSandbox,
  loadQuickJSWasm,
};

export default host;
