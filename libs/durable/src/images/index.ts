import {
  PhotonImage,
  SamplingFilter,
  type SyncInitInput,
  fliph,
  flipv,
  initSync,
  resize,
} from "@silvia-odwyer/photon/photon_rs.js";

import promiseTryModule from "../promise-try.ts";
import imageModule from "../tools/image.ts";
import type imageTypes from "../tools/image.types.ts";
import exif from "./exif.ts";

const { promiseTry } = promiseTryModule;
const { exifOrientation } = exif;
const { INLINE_IMAGE_TYPES, base64Length, toBase64 } = imageModule;

const JPEG_QUALITIES = [80, 70, 55, 40];

function createPhotonImages(wasm: SyncInitInput): imageTypes.ImageProcessor {
  initSync({ module: wasm });
  return {
    prepare: (bytes, mimeType, limits) => promiseTry(() => prepare(bytes, mimeType, limits)),
  };
}

function flipped(image: PhotonImage, orientation: number): void {
  if (orientation === 1) return;
  if (orientation !== 4) fliph(image);
  if (orientation !== 2) flipv(image);
}

function fitWithin(
  image: PhotonImage,
  mimeType: string,
  limits: imageTypes.ImageLimits,
): imageTypes.PreparedImage | undefined {
  const width = image.get_width();
  const height = image.get_height();
  const scale = Math.min(1, limits.maxWidth / width, limits.maxHeight / height);
  let target = {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
  for (;;) {
    const encoded = encodeWithin(image, target, limits.maxBytes, mimeType === "image/jpeg");
    if (encoded !== undefined) {
      const resized =
        target.width === width && target.height === height
          ? {}
          : { resized: { from: { height, width }, to: target } };
      const converted = encoded.mimeType === mimeType ? {} : { convertedFrom: mimeType };
      return { ...encoded, ...converted, ...resized };
    }
    if (target.width === 1 && target.height === 1) return undefined;
    target = {
      height: Math.max(1, Math.floor(target.height * 0.75)),
      width: Math.max(1, Math.floor(target.width * 0.75)),
    };
  }
}

function prepare(
  bytes: Uint8Array,
  mimeType: string,
  limits: imageTypes.ImageLimits,
): imageTypes.PreparedImage | undefined {
  const orientation = exifOrientation(bytes);
  let image: PhotonImage | undefined;
  try {
    image = PhotonImage.new_from_byteslice(bytes);
    if (
      INLINE_IMAGE_TYPES.has(mimeType) &&
      orientation === 1 &&
      image.get_width() <= limits.maxWidth &&
      image.get_height() <= limits.maxHeight &&
      base64Length(bytes.byteLength) <= limits.maxBytes
    ) {
      return { data: toBase64(bytes), mimeType };
    }
    if (orientation >= 5) {
      const turned = transposed(image, orientation);
      image.free();
      image = undefined;
      image = new PhotonImage(turned.pixels, turned.width, turned.height);
    } else {
      flipped(image, orientation);
    }
    return fitWithin(image, mimeType, limits);
  } catch {
    return undefined;
  } finally {
    image?.free();
  }
}

function encodeWithin(
  image: PhotonImage,
  size: { readonly width: number; readonly height: number },
  maxBytes: number,
  jpegFirst: boolean,
): { readonly data: string; readonly mimeType: string } | undefined {
  const same = size.width === image.get_width() && size.height === image.get_height();
  const scaled = same ? image : resize(image, size.width, size.height, SamplingFilter.Lanczos3);
  try {
    const png = { encode: () => scaled.get_bytes(), mimeType: "image/png" };
    const jpegs = JPEG_QUALITIES.map((quality) => ({
      encode: () => scaled.get_bytes_jpeg(quality),
      mimeType: "image/jpeg",
    }));
    for (const candidate of jpegFirst ? [...jpegs, png] : [png, ...jpegs]) {
      const bytes = candidate.encode();
      if (base64Length(bytes.byteLength) <= maxBytes)
        return { data: toBase64(bytes), mimeType: candidate.mimeType };
    }
    return undefined;
  } finally {
    if (!same) scaled.free();
  }
}

function transposed(
  image: PhotonImage,
  orientation: number,
): { readonly pixels: Uint8Array; readonly width: number; readonly height: number } {
  const width = image.get_width();
  const height = image.get_height();
  const source = image.get_raw_pixels();
  const pixels = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outX = orientation === 5 || orientation === 8 ? y : height - 1 - y;
      const outY = orientation === 5 || orientation === 6 ? x : width - 1 - x;
      pixels.set(
        source.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
        (outY * height + outX) * 4,
      );
    }
  }
  return { height: width, pixels, width: height };
}

const images = {
  createPhotonImages,
};

export default images;
