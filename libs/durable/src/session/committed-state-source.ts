import type {
  Context,
  ReplicatedStateSource,
  ReplicatedStateSourceAttachment,
  ReplicatedStateSourceFrame,
} from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type committedStateSourceTypes from "./committed-state-source.types.ts";
import SessionSourceAttachment from "./source-attachment.ts";
import type sourceAttachmentTypes from "./source-attachment.types.ts";

export default class CommittedStateSource<
  T = committedStateSourceTypes.ObservedDocumentValue,
> implements ReplicatedStateSource<T> {
  readonly #attachments = new Set<sourceAttachmentTypes.SessionSourceAttachment<T>>();
  #release: (() => void) | undefined;
  #value: T | undefined;
  #cursor = 0;
  #retired = false;
  #closed = false;

  constructor(value: T, release: () => void) {
    this.#value = value;
    this.#release = release;
  }

  attach(): ReplicatedStateSourceAttachment<T> {
    if (this.#closed) throw new Error("State source is closed");
    const attachment = new SessionSourceAttachment(
      { cursor: this.#cursor, value: this.#value as T },
      () => {
        this.#attachments.delete(attachment);
        if (this.#attachments.size === 0) this.#finishDisposal();
      },
    );
    this.#attachments.add(attachment);
    return attachment;
  }

  advance(value: T, ops: readonly Op[], context: Context): void {
    if (this.#closed || this.#retired) return;
    this.#value = value;
    this.#cursor += 1;
    if (value === null) this.#retired = true;
    const frame: ReplicatedStateSourceFrame<T> = {
      context,
      cursor: this.#cursor,
      ops,
      value,
    };
    for (const attachment of [...this.#attachments]) attachment.publish(frame);
  }

  closeSession(): void {
    if (this.#closed) return;
    for (const attachment of [...this.#attachments]) attachment.dispose();
    this.#finishDisposal();
  }

  #finishDisposal(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#value = undefined;
    const release = this.#release;
    this.#release = undefined;
    release?.();
  }
}
