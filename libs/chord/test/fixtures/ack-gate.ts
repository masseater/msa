import type chordTypes from "../../src/index.types.ts";

export default class AckGate implements chordTypes.Link {
  readonly inner: chordTypes.Link;
  readonly received: chordTypes.Frame[] = [];
  paused = false;
  #held: chordTypes.Frame | undefined;
  constructor(inner: chordTypes.Link) {
    this.inner = inner;
  }
  get closed(): boolean {
    return this.inner.closed;
  }
  send(frame: chordTypes.Frame): number | undefined {
    if (frame.t === "ack" && this.paused) {
      this.#held = frame;
      return 0;
    }
    return this.inner.send(frame);
  }
  release(): void {
    this.paused = false;
    if (this.#held !== undefined) this.inner.send(this.#held);
    this.#held = undefined;
  }
  receive(handler: (frame: chordTypes.Frame) => void): void {
    this.inner.receive((frame) => {
      this.received.push(frame);
      handler(frame);
    });
  }
  onClose(handler: (reason: string) => void): void {
    this.inner.onClose(handler);
  }
  close(reason?: string): void {
    this.inner.close(reason);
  }
}
