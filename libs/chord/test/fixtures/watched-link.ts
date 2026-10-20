import type chordTypes from "../../src/index.types.ts";

export default class WatchedLink implements chordTypes.Link {
  readonly inner: chordTypes.Link;
  readonly sent: chordTypes.Frame[] = [];
  closeOn: ((frame: chordTypes.Frame) => boolean) | undefined;
  constructor(inner: chordTypes.Link) {
    this.inner = inner;
  }
  get closed(): boolean {
    return this.inner.closed;
  }
  send(frame: chordTypes.Frame): number | undefined {
    this.sent.push(frame);
    if (this.closeOn?.(frame) === true) {
      this.inner.close("dropped");
      return undefined;
    }
    return this.inner.send(frame);
  }
  receive(handler: (frame: chordTypes.Frame) => void): void {
    this.inner.receive(handler);
  }
  onClose(handler: (reason: string) => void): void {
    this.inner.onClose(handler);
  }
  close(reason?: string): void {
    this.inner.close(reason);
  }
}
