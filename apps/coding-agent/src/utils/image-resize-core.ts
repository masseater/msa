import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import exifOrientation from "./exif-orientation.ts";
import type imageResizeCoreTypes from "./image-resize-core.types.ts";
import photonModule from "./photon.ts";

const { awaited, awaiting } = awaitingModule;
const { loadPhoton } = photonModule;
const { applyExifOrientation } = exifOrientation;

const IMAGE_RESIZE_WORKER_RESPONSE_TYPE = "msa:image-resize-response";

const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

const DEFAULT_OPTIONS: Required<imageResizeCoreTypes.ImageResizeOptions> = {
  jpegQuality: 80,
  maxBytes: DEFAULT_MAX_BYTES,
  maxHeight: 2000,
  maxWidth: 2000,
};

interface EncodedCandidate {
  data: string;
  encodedSize: number;
  mimeType: string;
}

function encodeCandidate(buffer: Uint8Array, mimeType: string): EncodedCandidate {
  const data = Buffer.from(buffer).toString("base64");
  return {
    data,
    encodedSize: Buffer.byteLength(data, "utf-8"),
    mimeType,
  };
}

type Photon = NonNullable<Awaited<ReturnType<typeof loadPhoton>>>;
type PhotonImage = ReturnType<Photon["PhotonImage"]["new_from_byteslice"]>;
type ResizeOptions = Required<imageResizeCoreTypes.ImageResizeOptions>;

interface Size {
  width: number;
  height: number;
}

function fitWithin({ width, height }: Size, opts: ResizeOptions): Size {
  let target = { height, width };
  if (target.width > opts.maxWidth) {
    target = {
      height: Math.round((target.height * opts.maxWidth) / target.width),
      width: opts.maxWidth,
    };
  }
  if (target.height > opts.maxHeight) {
    target = {
      height: opts.maxHeight,
      width: Math.round((target.width * opts.maxHeight) / target.height),
    };
  }
  return target;
}

function encodeAt(
  photon: Photon,
  image: PhotonImage,
  { width, height }: Size,
  jpegQualities: readonly number[],
): EncodedCandidate[] {
  const resized = photon.resize(image, width, height, photon.SamplingFilter.Lanczos3);
  try {
    return [
      encodeCandidate(resized.get_bytes(), "image/png"),
      ...jpegQualities.map((quality) =>
        encodeCandidate(resized.get_bytes_jpeg(quality), "image/jpeg"),
      ),
    ];
  } finally {
    resized.free();
  }
}

function shrink({ width, height }: Size): Size | undefined {
  const next = {
    height: height === 1 ? 1 : Math.max(1, Math.floor(height * 0.75)),
    width: width === 1 ? 1 : Math.max(1, Math.floor(width * 0.75)),
  };
  return next.width === width && next.height === height ? undefined : next;
}

function encodeUnderLimit(
  photon: Photon,
  image: PhotonImage,
  target: Size,
  opts: ResizeOptions,
): { candidate: EncodedCandidate; size: Size } | undefined {
  const qualitySteps = Array.from(new Set([opts.jpegQuality, 85, 70, 55, 40]));
  let size: Size | undefined = target;
  while (size !== undefined) {
    const fits = encodeAt(photon, image, size, qualitySteps).find(
      (candidate) => candidate.encodedSize < opts.maxBytes,
    );
    if (fits !== undefined) return { candidate: fits, size };
    size = shrink(size);
  }
  return undefined;
}

function resizeDecoded(
  photon: Photon,
  image: PhotonImage,
  inputBytes: Uint8Array,
  mimeType: string,
  opts: ResizeOptions,
): imageResizeCoreTypes.ResizedImage | null {
  const original = { height: image.get_height(), width: image.get_width() };
  const originals = { originalHeight: original.height, originalWidth: original.width };
  const inputBase64Size = Math.ceil(inputBytes.byteLength / 3) * 4;
  if (
    original.width <= opts.maxWidth &&
    original.height <= opts.maxHeight &&
    inputBase64Size < opts.maxBytes
  ) {
    const format = mimeType.split("/")[1] ?? "png";
    return {
      data: Buffer.from(inputBytes).toString("base64"),
      ...original,
      mimeType: mimeType || `image/${format}`,
      ...originals,
      wasResized: false,
    };
  }
  const encoded = encodeUnderLimit(photon, image, fitWithin(original, opts), opts);
  if (encoded === undefined) return null;
  return {
    data: encoded.candidate.data,
    ...encoded.size,
    mimeType: encoded.candidate.mimeType,
    ...originals,
    wasResized: true,
  };
}

function resizeImageInProcessImpl(
  inputBytes: Uint8Array,
  mimeType: string,
  options?: imageResizeCoreTypes.ImageResizeOptions,
): Promise<imageResizeCoreTypes.ResizedImage | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const photon = yield* awaited(loadPhoton());
      if (photon === null) return null;
      let image: PhotonImage | undefined;
      try {
        const rawImage = photon.PhotonImage.new_from_byteslice(inputBytes);
        image = applyExifOrientation(photon, rawImage, inputBytes);
        if (image !== rawImage) rawImage.free();
        return resizeDecoded(photon, image, inputBytes, mimeType, {
          ...DEFAULT_OPTIONS,
          ...options,
        });
      } catch {
        return null;
      } finally {
        image?.free();
      }
    }),
  );
}

const resizeImageInProcess: {
  (
    inputBytes: Uint8Array,
    mimeType: string,
    options?: imageResizeCoreTypes.ImageResizeOptions,
  ): Promise<imageResizeCoreTypes.ResizedImage | null>;
  (
    mimeType: string,
    options?: imageResizeCoreTypes.ImageResizeOptions,
  ): (inputBytes: Uint8Array) => Promise<imageResizeCoreTypes.ResizedImage | null>;
} = dual((args: IArguments) => args.length >= 2, resizeImageInProcessImpl);

const imageResizeCore = {
  IMAGE_RESIZE_WORKER_RESPONSE_TYPE,
  resizeImageInProcess,
};

export default imageResizeCore;
