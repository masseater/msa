import { BaseLink } from "./link-base.ts";
import { packObject, parseFrame } from "./link-pack.ts";
import type { Frame } from "./wire.ts";

export class MemoryLink extends BaseLink {
  peer: MemoryLink | undefined;
  #severed = false;
  #pending = Promise.resolve();

  sever(): void {
    this.#severed = true;
    if (this.peer !== undefined) this.peer.#severed = true;
  }

  protected transmit(frame: Frame): number | undefined {
    if (this.#severed) return undefined;
    const data = JSON.stringify(packObject(frame, true));
    const peer = this.peer;
    this.#pending = this.#pending.then(() => {
      if (!this.#severed && peer !== undefined) peer.deliver(parseFrame(data));
      return undefined;
    });
    return data.length;
  }

  protected shutdown(): void {
    const peer = this.peer;
    this.#pending = this.#pending.then(() => peer?.ended("peer closed"));
  }
}

export function memoryLinkPair(): [MemoryLink, MemoryLink] {
  const a = new MemoryLink();
  const b = new MemoryLink();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
