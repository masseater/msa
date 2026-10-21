import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import photonModule from "../photon.ts";

const { loadPhoton } = photonModule;
const { awaited, awaiting } = awaitingModule;

const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

function extensionForImageMimeType(mimeType: string): string | null {
  switch (baseMimeType(mimeType)) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}

function selectPreferredImageMimeType(mimeTypes: string[]): string | null {
  const normalized = mimeTypes
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ base: baseMimeType(t), raw: t }));

  for (const preferred of SUPPORTED_IMAGE_MIME_TYPES) {
    const match = normalized.find((t) => t.base === preferred);
    if (match !== undefined) {
      return match.raw;
    }
  }

  const anyImage = normalized.find((t) => t.base.startsWith("image/"));
  return anyImage?.raw ?? null;
}

function isSupportedImageMimeType(mimeType: string): boolean {
  const base = baseMimeType(mimeType);
  return SUPPORTED_IMAGE_MIME_TYPES.some((t) => t === base);
}

function convertToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const photon = yield* awaited(loadPhoton());
      if (photon === null) {
        return null;
      }

      try {
        const image = photon.PhotonImage.new_from_byteslice(bytes);
        try {
          return image.get_bytes();
        } finally {
          image.free();
        }
      } catch {
        return null;
      }
    }),
  );
}

const imageMime = {
  baseMimeType,
  convertToPng,
  extensionForImageMimeType,
  isSupportedImageMimeType,
  selectPreferredImageMimeType,
};

export default imageMime;
