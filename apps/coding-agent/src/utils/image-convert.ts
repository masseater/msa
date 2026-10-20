import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import { awaited, awaiting } from "../core/awaiting.ts";
import { applyExifOrientation } from "./exif-orientation.ts";
import { loadPhoton } from "./photon.ts";

const { getCapabilities, setImageTranscoder } = tui;

type Photon = NonNullable<Awaited<ReturnType<typeof loadPhoton>>>;

function encodePng(photon: Photon, bytes: Uint8Array): Uint8Array | null {
  try {
    const rawImage = photon.PhotonImage.new_from_byteslice(bytes);
    const image = applyExifOrientation(photon, rawImage, bytes);
    if (image !== rawImage) rawImage.free();
    try {
      return new Uint8Array(image.get_bytes());
    } finally {
      image.free();
    }
  } catch {
    return null;
  }
}

export function convertImageBytesToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  return Effect.runPromise(
    awaiting(function* () {
      const photon = yield* awaited(loadPhoton());
      if (photon === null) {
        return null;
      }
      return encodePng(photon, bytes);
    }),
  );
}

function convertToPngImpl(
  base64Data: string,
  mimeType: string,
): Promise<{ data: string; mimeType: string } | null> {
  return Effect.runPromise(
    awaiting(function* () {
      if (mimeType === "image/png") {
        return { data: base64Data, mimeType };
      }

      const bytes = new Uint8Array(Buffer.from(base64Data, "base64"));
      const pngBytes = yield* awaited(convertImageBytesToPng(bytes));
      if (pngBytes === null) {
        return null;
      }

      return {
        data: Buffer.from(pngBytes).toString("base64"),
        mimeType: "image/png",
      };
    }),
  );
}

export const convertToPng: {
  (base64Data: string, mimeType: string): Promise<{ data: string; mimeType: string } | null>;
  (mimeType: string): (base64Data: string) => Promise<{ data: string; mimeType: string } | null>;
} = dual((args: IArguments) => args.length >= 2, convertToPngImpl);

export function loadPngTranscoder(): Promise<tuiTypes.ImageTranscoder | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const photon = yield* awaited(loadPhoton());
      if (photon === null) return undefined;
      return (base64Data) => {
        const pngBytes = encodePng(photon, new Uint8Array(Buffer.from(base64Data, "base64")));
        return pngBytes === null ? null : Buffer.from(pngBytes).toString("base64");
      };
    }),
  );
}

let pngTranscoderLoad: Promise<boolean> | undefined;
let pngTranscoderRegistered = false;

export function ensurePngTranscoder(onRegistered: () => void): void {
  if (pngTranscoderRegistered || getCapabilities().images !== "kitty") return;
  pngTranscoderLoad ??= loadPngTranscoder().then((transcoder) => {
    if (transcoder === undefined) return false;
    setImageTranscoder(transcoder);
    pngTranscoderRegistered = true;
    return true;
  });
  void pngTranscoderLoad.then((registered) => {
    if (registered) onRegistered();
    return undefined;
  });
}
