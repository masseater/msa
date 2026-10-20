import { createNodePhotonImages } from "@msa/durable/images/node";
import { Effect, Fiber } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { exifOrientation } from "../src/images/exif.ts";
import {
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
  imageDimensions,
  toBase64,
} from "../src/tools/image.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import toolsImagesFixturesSupport from "./tools-images-fixtures-support.ts";
import toolsImagesSupport from "./tools-images-support.ts";

const { awaited, sampleEvery, toJsonText } = effectSupport;
const { runCommand } = platformSupport;
const {
  EXIF_HEADER,
  decodedImage,
  encode,
  encodeRgba,
  gif,
  noisyPng,
  setUpImages,
  tiff,
  withOrientation,
} = toolsImagesFixturesSupport;
const { prepareImageDirectory, removeImageDirectory } = toolsImagesSupport;

let processor: ImageProcessor;

beforeAll(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      processor = yield* setUpImages();
    }),
  ),
);

beforeAll(prepareImageDirectory);
afterAll(removeImageDirectory);

type Rgb = readonly [number, number, number];

function blocks(
  colors: readonly (readonly Rgb[])[],
  block: number,
): { rgba: Uint8Array; width: number; height: number } {
  const width = colors[0]!.length * block;
  const height = colors.length * block;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set(
        [...colors[Math.floor(y / block)]![Math.floor(x / block)]!, 255],
        (y * width + x) * 4,
      );
    }
  }
  return { height, rgba, width };
}

function webp(type: string, data: number[]): Uint8Array {
  return new Uint8Array([
    ...Buffer.from("RIFF"),
    0,
    0,
    0,
    0,
    ...Buffer.from("WEBP"),
    ...Buffer.from(type),
    0,
    0,
    0,
    0,
    ...data,
    ...new Array(16).fill(0),
  ]);
}

function webpWithOrientation(orientation: number, prefixed: boolean): Uint8Array {
  const chunk = (type: string, data: number[]): number[] => {
    const size = data.length;
    const padding = size % 2 === 1 ? [0] : [];
    return [...Buffer.from(type), size & 0xff, (size >> 8) & 0xff, 0, 0, ...data, ...padding];
  };
  const exif = [...(prefixed ? EXIF_HEADER : []), ...tiff(orientation, true)];
  const body = [...Buffer.from("WEBP"), ...chunk("VP8 ", [1, 2, 3]), ...chunk("EXIF", exif)];
  return new Uint8Array([
    ...Buffer.from("RIFF"),
    body.length & 0xff,
    (body.length >> 8) & 0xff,
    0,
    0,
    ...body,
  ]);
}

const R: Rgb = [255, 0, 0];

const G: Rgb = [0, 255, 0];

const B: Rgb = [0, 0, 255];

const W: Rgb = [255, 255, 255];

const K: Rgb = [0, 0, 0];

const Y: Rgb = [255, 255, 0];

const stored = [
  [R, G, B],
  [W, K, Y],
];

const mirror = <T>(grid: readonly (readonly T[])[]): T[][] => grid.map((row) => [...row].reverse());

const turn = <T>(grid: readonly (readonly T[])[]): T[][] =>
  grid[0]!.map((_, x) => grid.map((row) => row[x]!).reverse());

const upright: Record<number, Rgb[][]> = {
  1: stored.map((row) => [...row]),
  2: mirror(stored),
  3: turn(turn(stored)),
  4: turn(turn(mirror(stored))),
  5: turn(turn(turn(mirror(stored)))),
  6: turn(stored),
  7: turn(mirror(stored)),
  8: turn(turn(turn(stored))),
};

describe("EXIF orientation", () => {
  it.each(Array.from({ length: 8 }, (_, i) => i + 1))(
    "turns orientation %i upright",
    (orientation) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { rgba, width, height } = blocks(stored, 16);
          const jpeg = withOrientation(encodeRgba(rgba, width, height, "jpeg"), orientation);
          const prepared = yield* awaited(
            processor.prepare(jpeg, "image/jpeg", DEFAULT_IMAGE_LIMITS),
          );
          const image = decodedImage(prepared!.data);
          const expected = upright[orientation]!;
          expect({ height: image.height, width: image.width }).toEqual({
            height: expected.length * 16,
            width: expected[0]!.length * 16,
          });
          const seen = expected.map((row, by) =>
            row.map((_, bx) => {
              const at = ((by * 16 + 8) * image.width + bx * 16 + 8) * 4;
              return [...image.rgba.subarray(at, at + 3)].map((channel) =>
                channel > 127 ? 255 : 0,
              );
            }),
          );
          expect(seen).toEqual(expected);
        }),
      ),
  );

  it("reads big- and little-endian JPEG EXIF, after an APP0 segment, and 1 when absent or out of range", () => {
    const jpeg = encode(2, 2, "jpeg");
    expect(exifOrientation(withOrientation(jpeg, 6))).toBe(6);
    expect(exifOrientation(withOrientation(jpeg, 8, { little: true }))).toBe(8);
    expect(exifOrientation(withOrientation(jpeg, 5, { app0: true }))).toBe(5);
    expect(exifOrientation(withOrientation(jpeg, 9))).toBe(1);
    expect(exifOrientation(jpeg)).toBe(1);
    expect(exifOrientation(encode(2, 2, "png"))).toBe(1);
  });

  it("reads WebP EXIF chunks with and without the Exif prefix", () => {
    expect(exifOrientation(webpWithOrientation(6, false))).toBe(6);
    expect(exifOrientation(webpWithOrientation(3, true))).toBe(3);
  });
});

describe("imageDimensions", () => {
  it("reads the size each format declares in its header", () => {
    expect(imageDimensions(encode(7, 5, "png"), "image/png")).toEqual({ height: 5, width: 7 });
    expect(imageDimensions(encode(7, 5, "jpeg"), "image/jpeg")).toEqual({ height: 5, width: 7 });
    expect(
      imageDimensions(withOrientation(encode(7, 5, "jpeg"), 6, { app0: true }), "image/jpeg"),
    ).toEqual({
      height: 5,
      width: 7,
    });
    expect(imageDimensions(gif(300, 200), "image/gif")).toEqual({ height: 200, width: 300 });
    expect(
      imageDimensions(
        webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x2c, 0x01, 0xc8, 0x00]),
        "image/webp",
      ),
    ).toEqual({
      height: 200,
      width: 300,
    });
    const bits = 299 | (199 << 14);
    expect(
      imageDimensions(
        webp("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, bits >>> 24]),
        "image/webp",
      ),
    ).toEqual({ height: 200, width: 300 });
    expect(
      imageDimensions(webp("VP8X", [0, 0, 0, 0, 0x2b, 0x01, 0, 0xc7, 0, 0]), "image/webp"),
    ).toEqual({
      height: 200,
      width: 300,
    });
    expect(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBeUndefined();
  });
});

const encodes3MiB = Effect.gen(function* () {
  const source = new URL("../src/tools/image.ts", import.meta.url).href;
  const script = `
			const { toBase64 } = await import(${yield* toJsonText(source)});
			const bytes = Uint8Array.from({ length: 3147295 }, (_, index) => (index * 37) % 256);
			if (toBase64(bytes) !== Buffer.from(bytes).toString("base64")) throw new Error("mismatch");
		`;
  const args = [
    "--experimental-strip-types",
    "--max-heap-size=128",
    "--input-type=module",
    "-e",
    script,
  ];
  const result = yield* runCommand(process.execPath, args);
  expect(result.stderr).not.toMatch(/heap out of memory|mismatch/u);
  expect(result.status).toBe(0);
});

describe("toBase64", () => {
  it("matches Buffer for every remainder length", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 8191, 8192, 8193, 10_000, 16_385]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37) % 256);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  it("encodes a 3 MiB image within a 128 MB heap", () => Effect.runPromise(encodes3MiB), 20_000);
});

const preparesWorkerThread = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const photo = noisyPng(3000, 2000);
  const prepareOn = (images: ImageProcessor): Promise<number> =>
    runPromise(
      Effect.gen(function* () {
        let longest = 0;
        let last = performance.now();
        const ticks = yield* sampleEvery(5, () => {
          const now = performance.now();
          longest = Math.max(longest, now - last);
          last = now;
        });
        yield* Effect.gen(function* () {
          const prepared = images.prepare(photo, "image/png", DEFAULT_IMAGE_LIMITS);
          expect(yield* awaited(prepared)).toBeDefined();
          longest = Math.max(longest, performance.now() - last);
        }).pipe(Effect.ensuring(Fiber.interrupt(ticks)));
        return longest;
      }),
    );
  const inline = yield* awaited(
    prepareOn(yield* awaited(createNodePhotonImages({ worker: false }))),
  );
  const threaded = yield* awaited(prepareOn(processor));
  expect(inline).toBeGreaterThan(200);
  expect(threaded).toBeLessThan(inline / 4);
});

const givesSameResult = Effect.gen(function* () {
  const limits = { ...DEFAULT_IMAGE_LIMITS, maxBytes: 20_000 };
  const png = noisyPng(200, 200);
  const copy = png.slice();
  const threaded = yield* awaited(processor.prepare(png, "image/png", limits));
  const inline = yield* awaited(
    (yield* awaited(createNodePhotonImages({ worker: false }))).prepare(png, "image/png", limits),
  );
  expect(threaded?.mimeType).toBe("image/jpeg");
  expect(threaded?.resized?.from).toEqual({ height: 200, width: 200 });
  expect(threaded).toEqual(inline);
  expect(png).toEqual(copy);
});

describe("createNodePhotonImages", () => {
  it(
    "prepares in a worker thread, leaving the event loop free",
    () => Effect.runPromise(preparesWorkerThread),
    60_000,
  );

  it("gives the same result as the calling thread, and keeps the caller's bytes", () =>
    Effect.runPromise(givesSameResult));
});
