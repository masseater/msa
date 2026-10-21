declare namespace compressionTypes {
  interface Compression {
    deflateRaw(text: string): Uint8Array;
    inflateRaw(bytes: Uint8Array): string;
  }

  interface CompressionOptions {
    readonly compression?: Compression | undefined;
  }
}

export type { compressionTypes as default };
