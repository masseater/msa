import { createNodePhotonImages } from "@msa/durable/images/node";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { DEFAULT_IMAGE_LIMITS } from "../src/tools/image-processor.ts";
import { bmp, encode, setUpImages } from "./tools-images-fixtures-support.ts";
import { removeImageDirectory } from "./tools-images-support.ts";

beforeAll(async () => {
  await setUpImages();
});

afterAll(removeImageDirectory);

describe("createNodePhotonImages", () => {
  it("prepares concurrent images, and starts a new worker after the idle one exited", async () => {
    const images = await createNodePhotonImages({ idleMs: 10 });
    const results = await Promise.all([
      images.prepare(bmp(4, 4), "image/bmp", DEFAULT_IMAGE_LIMITS),
      images.prepare(encode(4000, 1000, "png"), "image/png", DEFAULT_IMAGE_LIMITS),
      images.prepare(new Uint8Array([1, 2, 3]), "image/png", DEFAULT_IMAGE_LIMITS),
    ]);
    expect(results[0]?.mimeType).toBe("image/png");
    expect(results[1]?.resized?.to).toEqual({ width: 2000, height: 500 });
    expect(results[2]).toBeUndefined();
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect((await images.prepare(bmp(2, 2), "image/bmp", DEFAULT_IMAGE_LIMITS))?.mimeType).toBe(
      "image/png",
    );
  });
});
