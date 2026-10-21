import decodeModule from "./decode.ts";

const { rangeDecoder } = decodeModule;

export default class StreamDecoder {
  readonly #decoder = rangeDecoder();
  #started = false;

  decode(bytes?: Uint8Array): string {
    const text =
      bytes === undefined ? this.#decoder.decode() : this.#decoder.decode(bytes, { stream: true });
    if (this.#started || text === "") return text;
    this.#started = true;
    return text.startsWith("\ufeff") ? text.slice(1) : text;
  }
}
