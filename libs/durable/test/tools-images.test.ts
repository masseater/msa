import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { createCodingTools } from "@msa/durable/tools";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { getOrThrow } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import {
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
  toBase64,
} from "../src/tools/image-processor.ts";
import { createReadTool } from "../src/tools/read.ts";
import {
  decodedImage,
  bmp,
  noisyPng,
  gif,
  encode,
  withOrientation,
  setUpImages,
} from "./tools-images-fixtures-support.ts";
import {
  onlyImage,
  messages,
  directory,
  read,
  removeImageDirectory,
} from "./tools-images-support.ts";

let processor: ImageProcessor;

beforeAll(async () => {
  processor = await setUpImages();
});

afterAll(removeImageDirectory);

// The environment of a `read` call, with `onRead` seeing each positional read of an opened file, and the largest
// read so far in `reads.largest`.
function readEnv(onRead?: (offset: number, length: number) => void) {
  const env = new NodeExecutionEnv({ cwd: directory });
  const reads = { largest: 0 };
  const open = env.openBinaryReader.bind(env);
  env.openBinaryReader = async (path, options, ctx) => {
    const reader = getOrThrow(await open(path, options, ctx));
    return {
      ok: true,
      value: {
        info: (c) => reader.info(c),
        scanLines: (o, c) => reader.scanLines(o, c),
        close: (c) => reader.close(c),
        read: async (offset, length, c) => {
          reads.largest = Math.max(reads.largest, length);
          const result = await reader.read(offset, length, c);
          onRead?.(offset, length);
          return result;
        },
      },
    };
  };
  return { env, reads };
}

describe("read of images, without an image processor", () => {
  it("returns a supported image within the limits as it is", async () => {
    const png = encode(8, 6, "png");
    const result = await read("a.png", png);
    expect(result.output).toEqual([{ type: "image", data: toBase64(png), mimeType: "image/png" }]);
    expect(messages(result)).toEqual(["Read image file [image/png]."]);
    const tiny = await read("a.gif", gif());
    expect(onlyImage(tiny)).toEqual({
      type: "image",
      data: toBase64(gif()),
      mimeType: "image/gif",
    });
  });

  it("refuses an image too large to send without reading it", async () => {
    const { env, reads } = readEnv();
    const result = await read("big.png", noisyPng(1100, 1100), { env });
    expect(result).toMatchObject({ output: [], isError: true });
    expect(messages(result)[0]).toMatch(
      /^big\.png is an image \(image\/png\) of .*, too large to send/u,
    );
    // Only the header and the chunk walk, in blocks of at most 64 KiB.
    expect(reads.largest).toBeLessThanOrEqual(64 * 1024);
  });

  it("refuses an image wider or taller than the limits, by its header", async () => {
    const wide = await read("wide.png", encode(2001, 2, "png"));
    expect(wide).toMatchObject({ output: [], isError: true });
    expect(messages(wide)).toEqual([
      "wide.png is an image (image/png) of 2001x2, larger than 2000x2000, and no image processor is configured to shrink it",
    ]);
    const tall = await read("tall.gif", gif(1, 3000));
    expect(messages(tall)[0]).toMatch(
      /^tall\.gif is an image \(image\/gif\) of 1x3000, larger than 2000x2000/u,
    );
  });

  it("refuses a format that needs converting", async () => {
    const result = await read("a.bmp", bmp(4, 4));
    expect(result).toMatchObject({ output: [], isError: true });
    expect(messages(result)).toEqual([
      "a.bmp is an image (image/bmp) that needs converting, and no image processor is configured",
    ]);
  });
});

describe("read of images, without an image processor", () => {
  it("says when the model sees a placeholder instead of the image", async () => {
    const result = await read("a.png", encode(4, 4, "png"), { input: ["text"] });
    expect(result.output).toHaveLength(1);
    expect(messages(result)).toEqual([
      "Read image file [image/png]. The current model does not support images; it sees a placeholder instead.",
    ]);
  });

  it("applies the model's image limits instead of the defaults", async () => {
    const png = encode(8, 6, "png");
    const refused = await read("a.png", png, { resize: { maxWidth: 4 } });
    expect(messages(refused)[0]).toMatch(/of 8x6, larger than 4x2000,/u);
    const resized = await read("a.png", png, { resize: { maxWidth: 4 }, images: processor });
    expect(decodedImage(onlyImage(resized).data)).toMatchObject({ width: 4, height: 3 });
  });

  it("lists bmp in the description only with a processor", () => {
    expect(createReadTool().description).toContain("(jpg, png, gif, webp)");
    expect(createReadTool({ images: processor }).description).toContain(
      "(jpg, png, gif, webp, bmp)",
    );
  });
});

describe("read of an image that changes while it is read", () => {
  it("reads it again rather than return a cut-off image, even when it grew", async () => {
    const png = encode(8, 6, "png");
    const wholeReads: number[] = [];
    const { env } = readEnv((offset, length) => {
      // A writer appends during the first read of the whole file; the second read sees it all.
      if (offset !== 0 || length < png.length) return;
      wholeReads.push(length);
      if (wholeReads.length === 1)
        appendFileSync(join(directory, "growing.png"), new Uint8Array(16));
    });
    const result = await read("growing.png", png, { env });
    expect(wholeReads).toEqual([png.length, png.length + 16]);
    const after = [...png, ...new Uint8Array(16)];
    expect(onlyImage(result).data).toBe(toBase64(new Uint8Array(after)));
  });

  it("fails when it changes during the second read too", async () => {
    const png = encode(8, 6, "png");
    const { env } = readEnv((offset, length) => {
      if (offset === 0 && length >= png.length)
        appendFileSync(join(directory, "busy.png"), new Uint8Array(1));
    });
    await expect(read("busy.png", png, { env })).rejects.toThrow(
      "busy.png changed while it was read",
    );
  });
});

describe("read of images, with the Photon image processor", () => {
  it("passes an image that needs no change through untouched", async () => {
    const png = encode(8, 6, "png");
    const result = await read("a.png", png, { images: processor });
    expect(result.output).toEqual([{ type: "image", data: toBase64(png), mimeType: "image/png" }]);
    expect(onlyImage(await read("a.gif", gif(), { images: processor })).mimeType).toBe("image/gif");
  });

  it("scales an image down to the maximum size, and says how to map coordinates back", async () => {
    const result = await read("wide.png", encode(4000, 1000, "png"), { images: processor });
    const block = onlyImage(result);
    expect(decodedImage(block.data)).toMatchObject({ width: 2000, height: 500 });
    expect(messages(result)).toEqual([
      `Read image file [${block.mimeType}]. Resized from 4000x1000 to 2000x500. Multiply coordinates by 2.00 to map them to the original.`,
    ]);
  });

  // Multiple full-image encodes can exceed Vitest's 5s default on shared CI runners.
  it("re-encodes a PNG too large for the byte limit as JPEG at its size, and shrinks it when that is not enough", async () => {
    const result = await read("big.png", noisyPng(1100, 1100), { images: processor });
    const jpeg = onlyImage(result);
    expect(jpeg.mimeType).toBe("image/jpeg");
    expect(messages(result)).toEqual([
      "Read image file [image/jpeg]. Converted from image/png to image/jpeg.",
    ]);
    expect(jpeg.data.length).toBeLessThanOrEqual(DEFAULT_IMAGE_LIMITS.maxBytes);
    expect(decodedImage(jpeg.data)).toMatchObject({ width: 1100, height: 1100 });
    const tight = { ...DEFAULT_IMAGE_LIMITS, maxBytes: 20_000 };
    const shrunk = await processor.prepare(noisyPng(400, 400), "image/png", tight);
    expect(shrunk!.data.length).toBeLessThanOrEqual(tight.maxBytes);
    expect(shrunk!.resized?.from).toEqual({ width: 400, height: 400 });
    expect(shrunk!.resized!.to.width).toBeLessThan(400);
  });

  it("keeps at least one pixel on each side of an extreme aspect ratio", async () => {
    const result = await processor.prepare(
      encode(6000, 2, "png"),
      "image/png",
      DEFAULT_IMAGE_LIMITS,
    );
    expect(result?.resized).toEqual({
      from: { width: 6000, height: 2 },
      to: { width: 2000, height: 1 },
    });
  });
});

describe("read of images, with the Photon image processor", () => {
  it("gives up when not even one pixel fits the byte limit", async () => {
    const limits = { ...DEFAULT_IMAGE_LIMITS, maxBytes: 8 };
    expect(await processor.prepare(encode(4, 4, "png"), "image/png", limits)).toBeUndefined();
  });

  it("keeps a JPEG that must be re-encoded a JPEG", async () => {
    const result = await processor.prepare(
      withOrientation(encode(40, 30, "jpeg"), 3),
      "image/jpeg",
      DEFAULT_IMAGE_LIMITS,
    );
    expect(result?.mimeType).toBe("image/jpeg");
  });

  it("converts a format providers do not take inline to PNG", async () => {
    const result = await read("a.bmp", bmp(4, 4), { images: processor });
    expect(result.output).toMatchObject([{ type: "image", mimeType: "image/png" }]);
    expect(messages(result)).toEqual([
      "Read image file [image/png]. Converted from image/bmp to image/png.",
    ]);
  });

  it("reports bytes it cannot decode as an error", async () => {
    const broken = new Uint8Array([...encode(4, 4, "png").subarray(0, 40)]);
    const result = await read("broken.png", broken, { images: processor });
    expect(result).toMatchObject({ output: [], isError: true });
    expect(messages(result)).toEqual([
      "broken.png is an image (image/png) that cannot be prepared for the model",
    ]);
  });

  it("is what createCodingTools({ images }) gives read", async () => {
    const tool = createCodingTools({ images: processor }).tools?.find(
      (candidate) => candidate.name === "read",
    );
    const result = await read("b.bmp", bmp(4, 4), {
      tool: tool as ReturnType<typeof createReadTool>,
    });
    expect(result.output).toMatchObject([{ type: "image", mimeType: "image/png" }]);
  });
});
