import type compressionTypes from "./compression.types.ts";

export default class Packed {
  readonly bytes: Uint8Array;
  readonly compression: compressionTypes.Compression;
  constructor(bytes: Uint8Array, compression: compressionTypes.Compression) {
    this.bytes = bytes;
    this.compression = compression;
  }
}
