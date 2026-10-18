import type { PathOrFileDescriptor } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";

import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
import { dirname, join } from "../core/platform-node.ts";

const require = createRequire(import.meta.url);
const fs = require("fs") as typeof import("fs");

export type { PhotonImage as PhotonImageType } from "@silvia-odwyer/photon-node";

type ReadFileSync = typeof fs.readFileSync;

const WASM_FILENAME = "photon_rs_bg.wasm";

let photonModule: typeof import("@silvia-odwyer/photon-node") | null = null;
let loadPromise: Promise<typeof import("@silvia-odwyer/photon-node") | null> | null = null;

function pathOrNull(file: PathOrFileDescriptor): string | null {
  if (typeof file === "string") {
    return file;
  }
  if (file instanceof URL) {
    return fileURLToPath(file);
  }
  return null;
}

function getFallbackWasmPaths(): string[] {
  const execDir = dirname(process.execPath);
  return [
    join(execDir, WASM_FILENAME),
    join(execDir, "photon", WASM_FILENAME),
    join(process.cwd(), WASM_FILENAME),
  ];
}

function patchPhotonWasmRead(): () => void {
  const originalReadFileSync: ReadFileSync = fs.readFileSync.bind(fs);
  const fallbackPaths = getFallbackWasmPaths();
  const mutableFs = fs as { readFileSync: ReadFileSync };

  const patchedReadFileSync: ReadFileSync = ((...args: Parameters<ReadFileSync>) => {
    const [file, options] = args;
    const resolvedPath = pathOrNull(file);

    if (resolvedPath?.endsWith(WASM_FILENAME) === true) {
      try {
        return originalReadFileSync(...args);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code !== undefined && err?.code !== "" && err.code !== "ENOENT") {
          throw error;
        }

        for (const fallbackPath of fallbackPaths) {
          if (!fs.existsSync(fallbackPath)) {
            continue;
          }
          if (options === undefined) {
            return originalReadFileSync(fallbackPath);
          }
          return originalReadFileSync(fallbackPath, options);
        }

        throw error;
      }
    }

    return originalReadFileSync(...args);
  }) as ReadFileSync;

  try {
    mutableFs.readFileSync = patchedReadFileSync;
  } catch {
    Object.defineProperty(fs, "readFileSync", {
      value: patchedReadFileSync,
      writable: true,
      configurable: true,
    });
  }

  return () => {
    try {
      mutableFs.readFileSync = originalReadFileSync;
    } catch {
      Object.defineProperty(fs, "readFileSync", {
        value: originalReadFileSync,
        writable: true,
        configurable: true,
      });
    }
  };
}

export function loadPhoton(): Promise<typeof import("@silvia-odwyer/photon-node") | null> {
  return Effect.runPromise(
    awaiting(function* () {
      if (photonModule !== null) {
        return photonModule;
      }

      if (loadPromise !== null) {
        return yield* awaited(loadPromise);
      }

      loadPromise = (() =>
        Effect.runPromise(
          awaiting(function* () {
            const restoreReadFileSync = patchPhotonWasmRead();
            try {
              photonModule = yield* awaited(import("@silvia-odwyer/photon-node"));
              return photonModule;
            } catch {
              photonModule = null;
              return photonModule;
            } finally {
              restoreReadFileSync();
            }
          }),
        ))();

      return yield* awaited(loadPromise);
    }),
  );
}
