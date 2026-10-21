import type compressionTypes from "./compression.types.ts";
import BaseLink from "./link-base.ts";
import linkPack from "./link-pack.ts";
import type wireTypes from "./wire.types.ts";

const { packObject, parseFrame } = linkPack;

export default class MemoryLink extends BaseLink {
  peer: MemoryLink | undefined;
  readonly #compression: compressionTypes.Compression | undefined;
  #severed = false;
  #pending = Promise.resolve();

  constructor(options: compressionTypes.CompressionOptions = {}) {
    super();
    this.#compression = options.compression;
  }

  sever(): void {
    this.#severed = true;
    if (this.peer !== undefined) this.peer.#severed = true;
  }

  protected transmit(frame: wireTypes.Frame): number | undefined {
    if (this.#severed) return undefined;
    const data = JSON.stringify(packObject(frame, this.#compression));
    const peer = this.peer;
    this.#pending = this.#pending.then(() => {
      if (!this.#severed && peer !== undefined) peer.deliver(parseFrame(data, peer.#compression));
      return undefined;
    });
    return data.length;
  }

  protected shutdown(): void {
    const peer = this.peer;
    this.#pending = this.#pending.then(() => peer?.ended("peer closed"));
  }
}
