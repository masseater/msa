import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import imageConvert from "./image-convert.ts";
import type imageProcessTypes from "./image-process.types.ts";
import imageResize from "./image-resize.ts";

const { awaited, awaiting } = awaitingModule;
const { convertImageBytesToPng } = imageConvert;
const { formatDimensionNote, resizeImage } = imageResize;

interface NormalizedImage {
  bytes: Uint8Array;
  mimeType: string;
  convertedFrom?: string;
}

function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function normalizeSupportedImageMimeType(mimeType: string): string | null {
  switch (baseMimeType(mimeType)) {
    case "image/png":
      return "image/png";
    case "image/jpeg":
    case "image/jpg":
      return "image/jpeg";
    case "image/gif":
      return "image/gif";
    case "image/webp":
      return "image/webp";
    default:
      return null;
  }
}

function normalizeImage(bytes: Uint8Array, mimeType: string): Promise<NormalizedImage | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const normalizedMimeType = normalizeSupportedImageMimeType(mimeType);
      if (normalizedMimeType !== null && normalizedMimeType !== "") {
        return { bytes, mimeType: normalizedMimeType };
      }

      const pngBytes = yield* awaited(convertImageBytesToPng(bytes));
      if (pngBytes === null) {
        return null;
      }

      return {
        bytes: pngBytes,
        convertedFrom: baseMimeType(mimeType),
        mimeType: "image/png",
      };
    }),
  );
}

function conversionHint(from: string | undefined, to: string): string | undefined {
  if (from === undefined || from === "" || from === to) return undefined;
  return `[Image converted from ${from} to ${to}.]`;
}

const hintsFor = (...notes: (string | undefined)[]): string[] =>
  notes.filter((note): note is string => note !== undefined && note !== "");

const omitted = (message: string): imageProcessTypes.ProcessImageResult => ({ message, ok: false });

function processImageImpl(
  bytes: Uint8Array,
  mimeType: string,
  options?: imageProcessTypes.ProcessImageOptions,
): Promise<imageProcessTypes.ProcessImageResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const normalized = yield* awaited(normalizeImage(bytes, mimeType));
      if (normalized === null) {
        return omitted(
          "[Image omitted: could not be converted to a supported inline image format.]",
        );
      }
      if (!(options?.autoResizeImages ?? true)) {
        return {
          data: Buffer.from(normalized.bytes).toString("base64"),
          hints: hintsFor(conversionHint(normalized.convertedFrom, normalized.mimeType)),
          mimeType: normalized.mimeType,
          ok: true,
        };
      }
      const resized = yield* awaited(
        resizeImage(normalized.bytes, normalized.mimeType, options?.resizeOptions),
      );
      if (resized === null) {
        return omitted("[Image omitted: could not be resized below the inline image size limit.]");
      }
      return {
        data: resized.data,
        hints: hintsFor(
          conversionHint(normalized.convertedFrom, resized.mimeType),
          formatDimensionNote(resized),
        ),
        mimeType: resized.mimeType,
        ok: true,
      };
    }),
  );
}

const processImage: {
  (
    bytes: Uint8Array,
    mimeType: string,
    options?: imageProcessTypes.ProcessImageOptions,
  ): Promise<imageProcessTypes.ProcessImageResult>;
  (
    mimeType: string,
    options?: imageProcessTypes.ProcessImageOptions,
  ): (bytes: Uint8Array) => Promise<imageProcessTypes.ProcessImageResult>;
} = dual((args: IArguments) => args.length >= 2, processImageImpl);

const imageProcess = {
  processImage,
};

export default imageProcess;
