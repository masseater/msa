import type { Frame } from "./wire.ts";

export interface Link {
  readonly closed: boolean;
  send(frame: Frame): number | undefined;
  receive(handler: (frame: Frame) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(reason?: string): void;
}

export abstract class BaseLink implements Link {
  #handler: ((frame: Frame) => void) | undefined;
  #queue: Frame[] = [];
  readonly #closeHandlers = new Set<(reason: string) => void>();
  #closed = false;
  #decoding: Promise<void> | undefined;

  get closed(): boolean {
    return this.#closed;
  }

  protected abstract transmit(frame: Frame): number | undefined;
  protected abstract shutdown(): void;

  send(frame: Frame): number | undefined {
    if (this.#closed) return undefined;
    return this.transmit(frame);
  }

  receive(handler: (frame: Frame) => void): void {
    this.#handler = handler;
    for (const frame of this.#queue.splice(0)) handler(frame);
  }

  onClose(handler: (reason: string) => void): void {
    if (this.#closed) handler("closed");
    else this.#closeHandlers.add(handler);
  }

  close(reason = "closed"): void {
    if (this.#closed) return;
    try {
      this.transmit({ t: "bye", reason });
    } catch {}
    this.ended(reason);
  }

  protected deliver(frame: Frame): void {
    if (this.#decoding === undefined) this.#deliverNow(frame);
    else this.deliverLater(Promise.resolve(frame));
  }

  protected deliverLater(frame: Promise<Frame>): void {
    const next = (this.#decoding ?? Promise.resolve())
      .then(() => frame)
      .then(
        (decoded) => this.#deliverNow(decoded),
        () => this.close("protocol error"),
      )
      .finally(() => {
        if (this.#decoding === next) this.#decoding = undefined;
      });
    this.#decoding = next;
  }

  #deliverNow(frame: Frame): void {
    if (this.#closed) return;
    if (frame.t === "bye") {
      this.ended(frame.reason ?? "peer closed");
      return;
    }
    if (this.#handler === undefined) this.#queue.push(frame);
    else this.#handler(frame);
  }

  protected ended(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue = [];
    try {
      this.shutdown();
    } finally {
      for (const handler of this.#closeHandlers) handler(reason);
      this.#closeHandlers.clear();
    }
  }
}
