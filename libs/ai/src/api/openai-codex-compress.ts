import type * as NodeZlib from "node:zlib";

import { isNodeRuntime } from "../utils/runtime.ts";

const REQUEST_COMPRESSION_ZSTD_LEVEL = 3;

type ProcessWithBuiltinModule = typeof process & {
  getBuiltinModule?: (id: "node:zlib") => typeof NodeZlib;
};

function loadNodeZlib(): typeof NodeZlib | null {
  if (!isNodeRuntime()) return null;
  return (process as ProcessWithBuiltinModule).getBuiltinModule?.("node:zlib") ?? null;
}

export function compressRequestBodyZstd(bodyJson: string): Uint8Array<ArrayBuffer> | null {
  const zlib = loadNodeZlib();
  if (zlib === null || typeof zlib.zstdCompressSync !== "function") return null;
  try {
    const compressed = zlib.zstdCompressSync(bodyJson, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: REQUEST_COMPRESSION_ZSTD_LEVEL },
    });
    return new Uint8Array(compressed);
  } catch {
    return null;
  }
}
