import { createNodePhotonImages } from "@msa/durable/images/node";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { DEFAULT_IMAGE_LIMITS } from "../src/tools/image.ts";
import { awaited } from "./effect-support.ts";
import { bmp, encode, setUpImages } from "./tools-images-fixtures-support.ts";
import { removeImageDirectory } from "./tools-images-support.ts";

beforeAll(() => Effect.runPromise(Effect.asVoid(Effect.suspend(() => awaited(setUpImages())))));

afterAll(removeImageDirectory);

const preparesConcurrentImages = Effect.gen(function* () {
  const images = yield* awaited(createNodePhotonImages({ idleMs: 10 }));
  const results = yield* awaited(
    Promise.all([
      images.prepare(bmp(4, 4), "image/bmp", DEFAULT_IMAGE_LIMITS),
      images.prepare(encode(4000, 1000, "png"), "image/png", DEFAULT_IMAGE_LIMITS),
      images.prepare(new Uint8Array([1, 2, 3]), "image/png", DEFAULT_IMAGE_LIMITS),
    ]),
  );
  expect(results[0]?.mimeType).toBe("image/png");
  expect(results[1]?.resized?.to).toEqual({ width: 2000, height: 500 });
  expect(results[2]).toBeUndefined();
  yield* Effect.sleep(100);
  expect(
    (yield* awaited(images.prepare(bmp(2, 2), "image/bmp", DEFAULT_IMAGE_LIMITS)))?.mimeType,
  ).toBe("image/png");
});

describe("createNodePhotonImages", () => {
  it("prepares concurrent images, and starts a new worker after the idle one exited", () =>
    Effect.runPromise(preparesConcurrentImages));
});
