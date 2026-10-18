import { BACKGROUND_CONTEXT } from "../../src/context/index.ts";
import type { Op } from "../../src/delta/index.ts";
import {
  type Context,
  type ReplicatedStateSource,
  type ReplicatedStateSourceAttachment,
} from "../../src/index.ts";
import { TestSourceAttachment } from "./replicated-state-attachment.ts";

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
