import type {
  Context,
  ReplicatedStateSource,
  ReplicatedStateSourceAttachment,
  ReplicatedStateSourceFrame,
} from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type { JsonObject } from "../types.ts";
import { SessionSourceAttachment } from "./source-attachment.ts";

export type ObservedDocumentValue = Readonly<JsonObject> | null;

export const RETIREMENT_OPERATIONS: readonly Op[] = [["r", null]];

export class CommittedStateSource<T = ObservedDocumentValue> implements ReplicatedStateSource<T> {
  readonly #attachments = new Set<SessionSourceAttachment<T>>();
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
      { value: this.#value as T, cursor: this.#cursor },
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
      cursor: this.#cursor,
      value,
      ops,
      context,
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
