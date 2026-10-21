import contextModule from "../../src/context/index.ts";
import type deltaTypes from "../../src/delta/index.types.ts";
import type chordTypes from "../../src/index.types.ts";
import TestSourceAttachment from "./replicated-state-attachment.ts";

const { BACKGROUND_CONTEXT } = contextModule;

class TestSource<T> implements chordTypes.ReplicatedStateSource<T> {
  readonly attachments = new Set<TestSourceAttachment<T>>();
  onAttach: (() => void) | undefined;
  #value: T;
  #cursor: number;

  constructor(value: T, cursor = 0) {
    this.#value = value;
    this.#cursor = cursor;
  }

  attach(): chordTypes.ReplicatedStateSourceAttachment<T> {
    const attachment = new TestSourceAttachment(
      Object.freeze({ cursor: this.#cursor, value: this.#value }),
      () => this.attachments.delete(attachment),
    );
    this.attachments.add(attachment);
    this.onAttach?.();
    return attachment;
  }

  commit(
    value: T,
    ops: readonly deltaTypes.Op[],
    context: chordTypes.Context = BACKGROUND_CONTEXT,
    cursor = this.#cursor + 1,
  ): void {
    this.#value = value;
    this.#cursor = cursor;
    const frame = Object.freeze({ context, cursor, ops, value });
    for (const attachment of [...this.attachments]) attachment.publish(frame);
  }
}

export default TestSource;
