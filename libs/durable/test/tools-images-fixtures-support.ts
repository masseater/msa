import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createNodePhotonImages } from "@msa/durable/images/node";
import { initSync, PhotonImage } from "@silvia-odwyer/photon/photon_rs.js";

import type { ImageProcessor } from "../src/tools/image-processor.ts";

// Fixtures are built with Photon here; the processor prepares them in its worker thread.
export function setUpImages(): Promise<ImageProcessor> {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve("@silvia-odwyer/photon/photon_rs_bg.wasm"),
    ),
  });
  return createNodePhotonImages();
}

// RGBA pixels of a `width` by `height` image: red, with a green top-left pixel.
export function pixels(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) rgba.set([255, 0, 0, 255], index * 4);
  rgba.set([0, 255, 0, 255], 0);
  return rgba;
}

export function encodeRgba(
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

export function encode(width: number, height: number, format: "png" | "jpeg"): Uint8Array {
  return encodeRgba(pixels(width, height), width, height, format);
}

// Noise, which neither PNG nor JPEG compresses well, so the byte limit decides.
export function noisyPng(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  let seed = 1;
  for (let index = 0; index < rgba.length; index++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    rgba[index] = index % 4 === 3 ? 255 : seed >>> 24;
  }
  return encodeRgba(rgba, width, height, "png");
}

// A 24-bit BMP, which providers do not take inline.
export function bmp(width: number, height: number): Uint8Array {
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

// A 1x1 GIF with its logical screen size set to `width` by `height`.
export function gif(width = 1, height = 1): Uint8Array {
  const bytes = Uint8Array.from(
    Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  );
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

// A TIFF header whose first directory holds only Orientation = `orientation`.
export function tiff(orientation: number, littleEndian: boolean): number[] {
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

export const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];

// `jpeg` with an APP1 segment whose EXIF says `orientation`, after an APP0 segment when `app0`.
export function withOrientation(
  jpeg: Uint8Array,
  orientation: number,
  options: { little?: boolean; app0?: boolean } = {},
) {
  const exif = [...EXIF_HEADER, ...tiff(orientation, options.little ?? false)];
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif];
  const app0 = options.app0
    ? [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
    : [];
  return new Uint8Array([...jpeg.subarray(0, 2), ...app0, ...app1, ...jpeg.subarray(2)]);
}

export function decodedImage(data: string): { width: number; height: number; rgba: Uint8Array } {
  const image = PhotonImage.new_from_byteslice(Uint8Array.from(Buffer.from(data, "base64")));
  try {
    return { width: image.get_width(), height: image.get_height(), rgba: image.get_raw_pixels() };
  } finally {
    image.free();
  }
}
