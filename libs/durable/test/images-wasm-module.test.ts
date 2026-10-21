import { createRequire } from "node:module";

import imagesModule from "@msa/durable/images";
import toolsModule from "@msa/durable/tools";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";

const { createPhotonImages } = imagesModule;
const { DEFAULT_IMAGE_LIMITS } = toolsModule;

const { awaited } = effectSupport;
const { readBytes } = platformSupport;

it("createPhotonImages takes a compiled WebAssembly module, as Cloudflare Workers pass it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = createRequire(import.meta.url).resolve(
        "@silvia-odwyer/photon/photon_rs_bg.wasm",
      );
      const { WebAssembly } = globalThis as unknown as {
        WebAssembly: { compile(bytes: Uint8Array): Promise<object> };
      };
      const module = (yield* awaited(WebAssembly.compile(yield* readBytes(path)))) as Parameters<
        typeof createPhotonImages
      >[0];
      const images = createPhotonImages(module);
      const data = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      const prepared = yield* awaited(
        images.prepare(Buffer.from(data, "base64"), "image/gif", DEFAULT_IMAGE_LIMITS),
      );
      expect(prepared).toEqual({ data, mimeType: "image/gif" });
    }),
  ));
