export function rangeDecoder(): InstanceType<typeof TextDecoder> {
  return new TextDecoder("utf-8", { ignoreBOM: true });
}

export function startsWithBom(firstBytes: Uint8Array): boolean {
  return firstBytes[0] === 0xef && firstBytes[1] === 0xbb && firstBytes[2] === 0xbf;
}

export class StreamDecoder {
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
