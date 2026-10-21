import type chordTypes from "../../src/index.types.ts";

class TestSourceAttachment<T> implements chordTypes.ReplicatedStateSourceAttachment<T> {
  readonly snapshot: { readonly value: T; readonly cursor: number };
  readonly #onDispose: () => void;
  readonly #buffer: chordTypes.ReplicatedStateSourceFrame<T>[] = [];
  #listener: ((frame: chordTypes.ReplicatedStateSourceFrame<T>) => void) | undefined;
  #activated = false;
  #disposed = false;

  constructor(snapshot: { readonly value: T; readonly cursor: number }, onDispose: () => void) {
    this.snapshot = snapshot;
    this.#onDispose = onDispose;
  }

  activate(listener: (frame: chordTypes.ReplicatedStateSourceFrame<T>) => void): void {
    if (this.#activated) throw new Error("attachment is already active");
    this.#activated = true;
    this.#listener = listener;
    for (const frame of this.#buffer.splice(0)) listener(frame);
  }

  publish(frame: chordTypes.ReplicatedStateSourceFrame<T>): void {
    if (this.#disposed) return;
    if (this.#listener === undefined) this.#buffer.push(frame);
    else this.#listener(frame);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#buffer.length = 0;
    this.#onDispose();
  }
}

export default TestSourceAttachment;
