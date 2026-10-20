import type chordTypes from "@msa/chord/index.types";

export default class SessionSourceAttachment<
  T,
> implements chordTypes.ReplicatedStateSourceAttachment<T> {
  readonly snapshot: { readonly value: T; readonly cursor: number };
  #release: (() => void) | undefined;
  readonly #frames: chordTypes.ReplicatedStateSourceFrame<T>[] = [];
  #listener: ((frame: chordTypes.ReplicatedStateSourceFrame<T>) => void) | undefined;
  #activated = false;
  #disposed = false;
  #scheduled = false;
  #delivering = false;

  constructor(snapshot: { readonly value: T; readonly cursor: number }, release: () => void) {
    this.snapshot = snapshot;
    this.#release = release;
  }

  activate(listener: (frame: chordTypes.ReplicatedStateSourceFrame<T>) => void): void {
    if (this.#activated) throw new Error("State attachment is already active");
    if (this.#disposed) throw new Error("State attachment is disposed");
    this.#activated = true;
    this.#listener = listener;
    this.#drain();
  }

  publish(frame: chordTypes.ReplicatedStateSourceFrame<T>): void {
    if (this.#disposed) return;
    this.#frames.push(frame);
    if (!this.#activated || this.#delivering || this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (this.#disposed) return;
      try {
        this.#drain();
      } catch {
        this.dispose();
      }
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#frames.length = 0;
    this.#listener = undefined;
    const release = this.#release;
    this.#release = undefined;
    release?.();
  }

  #drain(): void {
    const listener = this.#listener;
    if (listener === undefined || this.#delivering || this.#disposed) return;
    this.#delivering = true;
    try {
      while (!this.#disposed) {
        const frame = this.#frames.shift();
        if (frame === undefined) break;
        listener(frame);
      }
    } finally {
      this.#delivering = false;
    }
  }
}
