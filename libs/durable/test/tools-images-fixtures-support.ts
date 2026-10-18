import { createRequire } from "node:module";

import { createNodePhotonImages } from "@msa/durable/images/node";
import { initSync, PhotonImage } from "@silvia-odwyer/photon/photon_rs.js";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited } from "./effect-support.ts";
import { readBytes } from "./platform-support.ts";

export const setUpImages = Effect.fn("setUpImages")(function* () {
  const module = yield* readBytes(
    createRequire(import.meta.url).resolve("@silvia-odwyer/photon/photon_rs_bg.wasm"),
  );
  initSync({ module });
  return yield* awaited(createNodePhotonImages());
});

function pixelsImpl(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) rgba.set([255, 0, 0, 255], index * 4);
  rgba.set([0, 255, 0, 255], 0);
  return rgba;
}

export const pixels: {
  (height: number): (width: number) => ReturnType<typeof pixelsImpl>;
  (width: number, height: number): ReturnType<typeof pixelsImpl>;
} = dual(2, pixelsImpl);

function encodeRgbaImpl(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: "png" | "jpeg",
): Uint8Array {
  const image = new PhotonImage(rgba, width, height);
  try {
    return format === "png" ? image.get_bytes() : image.get_bytes_jpeg(95);
  } finally {
    image.free();
  }
}

export const encodeRgba: {
  (
    width: number,
    height: number,
    format: "png" | "jpeg",
  ): (rgba: Uint8Array) => ReturnType<typeof encodeRgbaImpl>;
  (
    rgba: Uint8Array,
    width: number,
    height: number,
    format: "png" | "jpeg",
  ): ReturnType<typeof encodeRgbaImpl>;
} = dual(4, encodeRgbaImpl);

function encodeImpl(width: number, height: number, format: "png" | "jpeg"): Uint8Array {
  return encodeRgba(pixels(width, height), width, height, format);
}

export const encode: {
  (height: number, format: "png" | "jpeg"): (width: number) => ReturnType<typeof encodeImpl>;
  (width: number, height: number, format: "png" | "jpeg"): ReturnType<typeof encodeImpl>;
} = dual(3, encodeImpl);

function noisyPngImpl(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  let seed = 1;
  for (let index = 0; index < rgba.length; index++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    rgba[index] = index % 4 === 3 ? 255 : seed >>> 24;
  }
  return encodeRgba(rgba, width, height, "png");
}

export const noisyPng: {
  (height: number): (width: number) => ReturnType<typeof noisyPngImpl>;
  (width: number, height: number): ReturnType<typeof noisyPngImpl>;
} = dual(2, noisyPngImpl);

function bmpImpl(width: number, height: number): Uint8Array {
  const row = Math.ceil((width * 3) / 4) * 4;
  const bytes = new Uint8Array(54 + row * height);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, row * height, true);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) bytes.set([0, 0, 255], 54 + y * row + x * 3);
  return bytes;
}

export const bmp: {
  (height: number): (width: number) => ReturnType<typeof bmpImpl>;
  (width: number, height: number): ReturnType<typeof bmpImpl>;
} = dual(2, bmpImpl);

function gifImpl(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from(
    Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  );
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

export const gif: {
  (height: number): (width: number) => ReturnType<typeof gifImpl>;
  (width: number, height: number): ReturnType<typeof gifImpl>;
} = dual(2, gifImpl);

function tiffImpl(orientation: number, littleEndian: boolean): number[] {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  bytes.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, 8, littleEndian);
  view.setUint16(8, 1, littleEndian);
  view.setUint16(10, 0x0112, littleEndian);
  view.setUint16(12, 3, littleEndian);
  view.setUint32(14, 1, littleEndian);
  view.setUint16(18, orientation, littleEndian);
  return [...bytes];
}

export const tiff: {
  (littleEndian: boolean): (orientation: number) => ReturnType<typeof tiffImpl>;
  (orientation: number, littleEndian: boolean): ReturnType<typeof tiffImpl>;
} = dual(2, tiffImpl);

export const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];

function withOrientationImpl(
  jpeg: Uint8Array,
  orientation: number,
  options: { little?: boolean; app0?: boolean } = {},
) {
  const exif = [...EXIF_HEADER, ...tiff(orientation, options.little ?? false)];
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif];
  const app0 =
    options.app0 === true
      ? [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
      : [];
  return new Uint8Array([...jpeg.subarray(0, 2), ...app0, ...app1, ...jpeg.subarray(2)]);
}

export const withOrientation: {
  (
    orientation: number,
    options?: { little?: boolean; app0?: boolean },
  ): (jpeg: Uint8Array) => ReturnType<typeof withOrientationImpl>;
  (
    jpeg: Uint8Array,
    orientation: number,
    options?: { little?: boolean; app0?: boolean },
  ): ReturnType<typeof withOrientationImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, withOrientationImpl);

export function decodedImage(data: string): { width: number; height: number; rgba: Uint8Array } {
  const image = PhotonImage.new_from_byteslice(Uint8Array.from(Buffer.from(data, "base64")));
  try {
    return { width: image.get_width(), height: image.get_height(), rgba: image.get_raw_pixels() };
  } finally {
    image.free();
  }
}
