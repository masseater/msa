import type { Effect } from "effect";

declare namespace imageTypes {
  type ByteSource = {
    readonly size: number;
    read(offset: number, length: number): Effect.Effect<Uint8Array>;
  };

  type ImageLimits = {
    readonly maxWidth: number;
    readonly maxHeight: number;
    readonly maxBytes: number;
  };

  type PreparedImage = {
    readonly data: string;
    readonly mimeType: string;
    readonly resized?: {
      readonly from: { readonly width: number; readonly height: number };
      readonly to: { readonly width: number; readonly height: number };
    };
    readonly convertedFrom?: string;
  };

  type ImageProcessor = {
    prepare(
      bytes: Uint8Array,
      mimeType: string,
      limits: ImageLimits,
    ): Promise<PreparedImage | undefined>;
  };
}

export type { imageTypes as default };
