import { createRequire } from "node:module";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as Effect from "effect/Effect";
import { FileSystem } from "effect/FileSystem";
import * as ManagedRuntime from "effect/ManagedRuntime";

export type CodemodeWasmModule = object;

const runtime = ManagedRuntime.make(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
  NodeFileSystem.layer,
);

const readFileBytes = (path: string): Promise<Uint8Array> =>
  runtime.runPromise(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- node:fs has no stable Effect replacement
    FileSystem.use((fs) => fs.readFile(path)).pipe(
      Effect.mapError((error) => error.cause ?? error),
    ),
  );

interface WebAssemblyGlobal {
  compile(bytes: Uint8Array): Promise<CodemodeWasmModule>;
}

const modules = new Map<string, Promise<CodemodeWasmModule>>();

export function loadQuickJSWasm(path?: string): Promise<CodemodeWasmModule> {
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
