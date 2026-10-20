import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import { awaited, awaiting } from "../core/awaiting.ts";
import { convertImageBytesToPng } from "./image-convert.ts";
import { type ImageResizeOptions, formatDimensionNote, resizeImage } from "./image-resize.ts";

export interface ProcessImageOptions {
  autoResizeImages?: boolean;

  resizeOptions?: ImageResizeOptions | undefined;
}

export type ProcessImageResult =
  | {
      ok: true;
      data: string;
      mimeType: string;
      hints: string[];
    }
  | {
      ok: false;
      message: string;
    };

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

function processImageImpl(
  bytes: Uint8Array,
  mimeType: string,
  options?: ProcessImageOptions,
): Promise<ProcessImageResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const autoResizeImages = options?.autoResizeImages ?? true;
      const normalized = yield* awaited(normalizeImage(bytes, mimeType));
      if (normalized === null) {
        return {
          message: "[Image omitted: could not be converted to a supported inline image format.]",
          ok: false,
        };
      }

      if (autoResizeImages) {
        const resized = yield* awaited(
          resizeImage(normalized.bytes, normalized.mimeType, options?.resizeOptions),
        );
        if (resized === null) {
          return {
            message: "[Image omitted: could not be resized below the inline image size limit.]",
            ok: false,
          };
        }

        const hints: string[] = [];
        const convertedHint = conversionHint(normalized.convertedFrom, resized.mimeType);
        if (convertedHint !== undefined && convertedHint !== "") hints.push(convertedHint);
        const dimensionNote = formatDimensionNote(resized);
        if (dimensionNote !== undefined && dimensionNote !== "") hints.push(dimensionNote);

        return {
          data: resized.data,
          hints,
          mimeType: resized.mimeType,
          ok: true,
        };
      }

      const hints: string[] = [];
      const convertedHint = conversionHint(normalized.convertedFrom, normalized.mimeType);
      if (convertedHint !== undefined && convertedHint !== "") hints.push(convertedHint);

      return {
        data: Buffer.from(normalized.bytes).toString("base64"),
        hints,
        mimeType: normalized.mimeType,
        ok: true,
      };
    }),
  );
}

export const processImage: {
  (bytes: Uint8Array, mimeType: string, options?: ProcessImageOptions): Promise<ProcessImageResult>;
  (
    mimeType: string,
    options?: ProcessImageOptions,
  ): (bytes: Uint8Array) => Promise<ProcessImageResult>;
} = dual((args: IArguments) => args.length >= 2, processImageImpl);
