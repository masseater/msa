import { BACKGROUND_CONTEXT } from "../../src/context/index.ts";
import type { Op } from "../../src/delta/index.ts";
import {
  type Context,
  type ReplicatedStateSource,
  type ReplicatedStateSourceAttachment,
  type ReplicatedStateSourceFrame,
} from "../../src/index.ts";

export type SourceValue = Readonly<{ value: number }>;

export class TestSource<T> implements ReplicatedStateSource<T> {
  readonly attachments = new Set<TestSourceAttachment<T>>();
  onAttach: (() => void) | undefined;
  #value: T;
  #cursor: number;

  constructor(value: T, cursor = 0) {
    this.#value = value;
    this.#cursor = cursor;
  }

  attach(): ReplicatedStateSourceAttachment<T> {
    const attachment = new TestSourceAttachment(
      Object.freeze({ value: this.#value, cursor: this.#cursor }),
      () => this.attachments.delete(attachment),
    );
    this.attachments.add(attachment);
    this.onAttach?.();
    return attachment;
  }

  commit(
    value: T,
    ops: readonly Op[],
    context: Context = BACKGROUND_CONTEXT,
    cursor = this.#cursor + 1,
  ): void {
    this.#value = value;
    this.#cursor = cursor;
    const frame = Object.freeze({ cursor, value, ops, context });
    for (const attachment of [...this.attachments]) attachment.publish(frame);
  }
}

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
