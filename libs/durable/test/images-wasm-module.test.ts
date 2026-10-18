import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { createPhotonImages } from "@msa/durable/images";
import { DEFAULT_IMAGE_LIMITS } from "@msa/durable/tools";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";

it("createPhotonImages takes a compiled WebAssembly module, as Cloudflare Workers pass it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = createRequire(import.meta.url).resolve(
        "@silvia-odwyer/photon/photon_rs_bg.wasm",
      );
      const { WebAssembly } = globalThis as unknown as {
        WebAssembly: { compile(bytes: Uint8Array): Promise<object> };
      };
      const module = (yield* awaited(
        WebAssembly.compile(yield* awaited(readFile(path))),
      )) as Parameters<typeof createPhotonImages>[0];
      const images = createPhotonImages(module);
      const data = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      const prepared = yield* awaited(
        images.prepare(Buffer.from(data, "base64"), "image/gif", DEFAULT_IMAGE_LIMITS),
      );
      expect(prepared).toEqual({ data, mimeType: "image/gif" });
    }),
  ));
