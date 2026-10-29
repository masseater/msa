import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import wasmReadFallback from "../core/platform/node/wasm-read-fallback.ts";

const { redirectMissingWasmRead } = wasmReadFallback;

const { awaited, awaiting } = awaitingModule;

const WASM_FILENAME = "photon_rs_bg.wasm";

let photonModule: typeof import("@silvia-odwyer/photon-node") | null = null;
let loadPromise: Promise<typeof import("@silvia-odwyer/photon-node") | null> | null = null;

let embeddedWasmPath: string | undefined;

function setEmbeddedWasmPath(path: string): void {
  embeddedWasmPath = path;
}

function getEmbeddedWasmPath(): string | undefined {
  return embeddedWasmPath;
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
            const restoreReadFileSync = redirectMissingWasmRead({
              fallbackPaths: embeddedWasmPath === undefined ? [] : [embeddedWasmPath],
              fileName: WASM_FILENAME,
            });
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
  getEmbeddedWasmPath,
  loadPhoton,
  setEmbeddedWasmPath,
};

export default photon;
