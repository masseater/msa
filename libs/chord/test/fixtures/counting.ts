import type { Frame, Link } from "../../src/index.ts";
import type countingTypes from "./counting.types.ts";

class CountingLink implements Link {
  readonly inner: Link;
  readonly sent: Frame[] = [];
  readonly received: Frame[] = [];
  sentBytes = 0;
  receivedBytes = 0;
  paused = false;
  #held: Frame | undefined;

  constructor(inner: Link) {
    this.inner = inner;
  }

  get closed(): boolean {
    return this.inner.closed;
  }

  send(frame: Frame): number | undefined {
    if (frame.t === "ack" && this.paused) {
      this.#held = frame;
      return 0;
    }
    this.sent.push(frame);
    this.sentBytes += JSON.stringify(frame).length;
    return this.inner.send(frame);
  }

  release(): void {
    this.paused = false;
    const held = this.#held;
    this.#held = undefined;
    if (held !== undefined) this.inner.send(held);
  }

  receive(handler: (frame: Frame) => void): void {
    this.inner.receive((frame) => {
      this.received.push(frame);
      this.receivedBytes += JSON.stringify(frame).length;
      handler(frame);
    });
  }

  onClose(handler: (reason: string) => void): void {
    this.inner.onClose(handler);
  }

  close(reason?: string): void {
    this.inner.close(reason);
  }

  count(direction: "sent" | "received", t: Frame["t"]): number {
    return this[direction].filter((frame) => frame.t === t).length;
  }

  traffic(direction: "sent" | "received"): Frame[] {
    return this[direction].filter(
      (frame) => frame.t !== "ping" && frame.t !== "pong" && frame.t !== "ack",
    );
  }
}

const stateFrames = (frames: readonly Frame[]): countingTypes.StateFrame[] =>
  frames.filter((frame): frame is countingTypes.StateFrame => frame.t === "state");

const counting = {
  CountingLink,
  stateFrames,
};

export default counting;
