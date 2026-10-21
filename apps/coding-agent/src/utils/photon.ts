import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform/index.ts";
import wasmReadFallback from "../core/platform/node/wasm-read-fallback.ts";

const { redirectMissingWasmRead } = wasmReadFallback;

const { dirname, join } = platform;
const { awaited, awaiting } = awaitingModule;

const WASM_FILENAME = "photon_rs_bg.wasm";

let photonModule: typeof import("@silvia-odwyer/photon-node") | null = null;
let loadPromise: Promise<typeof import("@silvia-odwyer/photon-node") | null> | null = null;

function getFallbackWasmPaths(): string[] {
  const execDir = dirname(process.execPath);
  return [
    join(execDir, WASM_FILENAME),
    join(execDir, "photon", WASM_FILENAME),
    join(process.cwd(), WASM_FILENAME),
  ];
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
              fallbackPaths: getFallbackWasmPaths(),
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
  loadPhoton,
};

export default photon;
