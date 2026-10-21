import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform/index.ts";
import nodeFsModule from "../core/platform/node/fs-module.ts";
import nodeUrl from "../core/platform/node/url.ts";

const { fsModule: fs } = nodeFsModule;
const { fileURLToPath } = nodeUrl;

const { dirname, join } = platform;
const { awaited, awaiting } = awaitingModule;

type ReadFileSync = typeof fs.readFileSync;
type PathOrFileDescriptor = Parameters<ReadFileSync>[0];

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

function setReadFileSync(readFileSync: ReadFileSync): void {
  try {
    (fs as { readFileSync: ReadFileSync }).readFileSync = readFileSync;
  } catch {
    Object.defineProperty(fs, "readFileSync", {
      configurable: true,
      value: readFileSync,
      writable: true,
    });
  }
}

function readFallbackWasm(
  readFileSync: ReadFileSync,
  fallbackPaths: readonly string[],
  options: Parameters<ReadFileSync>[1],
  error: unknown,
): ReturnType<ReadFileSync> {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code !== undefined && code !== "" && code !== "ENOENT") throw error;
  const fallbackPath = fallbackPaths.find((path) => fs.existsSync(path));
  if (fallbackPath === undefined) throw error;
  return options === undefined ? readFileSync(fallbackPath) : readFileSync(fallbackPath, options);
}

function patchPhotonWasmRead(): () => void {
  const originalReadFileSync: ReadFileSync = fs.readFileSync.bind(fs);
  const fallbackPaths = getFallbackWasmPaths();
  const patchedReadFileSync: ReadFileSync = ((...args: Parameters<ReadFileSync>) => {
    if (pathOrNull(args[0])?.endsWith(WASM_FILENAME) !== true) {
      return originalReadFileSync(...args);
    }
    try {
      return originalReadFileSync(...args);
    } catch (error) {
      return readFallbackWasm(originalReadFileSync, fallbackPaths, args[1], error);
    }
  }) as ReadFileSync;
  setReadFileSync(patchedReadFileSync);
  return () => setReadFileSync(originalReadFileSync);
}

function loadPhoton(): Promise<typeof import("@silvia-odwyer/photon-node") | null> {
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

const photon = {
  loadPhoton,
};

export default photon;
