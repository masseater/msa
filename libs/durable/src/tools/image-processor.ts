export type ImageLimits = {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxBytes: number;
};

export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: 4.5 * 1024 * 1024,
};

export type PreparedImage = {
  readonly data: string;
  readonly mimeType: string;
  readonly resized?: {
    readonly from: { readonly width: number; readonly height: number };
    readonly to: { readonly width: number; readonly height: number };
  };
  readonly convertedFrom?: string;
};

export type ImageProcessor = {
  prepare(
    bytes: Uint8Array,
    mimeType: string,
    limits: ImageLimits,
  ): Promise<PreparedImage | undefined>;
};

export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]));
  }
  return btoa(parts.join(""));
}

export function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}
