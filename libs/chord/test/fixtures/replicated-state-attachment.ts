import type {
  ReplicatedStateSourceAttachment,
  ReplicatedStateSourceFrame,
} from "../../src/index.ts";

export class TestSourceAttachment<T> implements ReplicatedStateSourceAttachment<T> {
  readonly snapshot: { readonly value: T; readonly cursor: number };
  readonly #onDispose: () => void;
  readonly #buffer: ReplicatedStateSourceFrame<T>[] = [];
  #listener: ((frame: ReplicatedStateSourceFrame<T>) => void) | undefined;
  #activated = false;
  #disposed = false;

  constructor(snapshot: { readonly value: T; readonly cursor: number }, onDispose: () => void) {
    this.snapshot = snapshot;
    this.#onDispose = onDispose;
  }

  activate(listener: (frame: ReplicatedStateSourceFrame<T>) => void): void {
    if (this.#activated) throw new Error("attachment is already active");
    this.#activated = true;
    this.#listener = listener;
    for (const frame of this.#buffer.splice(0)) listener(frame);
  }

  publish(frame: ReplicatedStateSourceFrame<T>): void {
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
