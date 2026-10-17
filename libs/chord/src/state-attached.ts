import { ReplicatedStatePublisher } from "./state-publisher.ts";
import { reportErrorAsync, toError } from "./state-report.ts";
import type {
  AttachedReplicatedState,
  ReplicatedStateSource,
  ReplicatedStateSourceAttachment,
  ReplicatedStateSourceFrame,
  ReplicatedStateSourceOptions,
  StateListener,
} from "./state-types.ts";

export class AttachedReplicatedStateImpl<T> implements AttachedReplicatedState<T> {
  readonly #publisher: ReplicatedStatePublisher<T>;
  readonly #attachment: ReplicatedStateSourceAttachment<T>;
  readonly #reportError: (error: Error) => void;
  #cursor: number;
  #disposed = false;

  constructor(
    attachment: ReplicatedStateSourceAttachment<T>,
    options: ReplicatedStateSourceOptions,
  ) {
    const { snapshot } = attachment;
    assertCursor(snapshot.cursor, "snapshot");
    this.#attachment = attachment;
    this.#cursor = snapshot.cursor;
    this.#reportError = options.onError ?? reportErrorAsync;
    this.#publisher = new ReplicatedStatePublisher(snapshot.value, (error) => this.#report(error));
  }

  get value(): T {
    return this.#publisher.value;
  }

  subscribe(listener: StateListener<T>): () => void {
    return this.#publisher.subscribe(listener);
  }

  activate(): void {
    this.#attachment.activate((frame) => this.#receive(frame));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#attachment.dispose();
  }

  #receive(frame: ReplicatedStateSourceFrame<T>): void {
    if (this.#disposed) return;
    try {
      assertCursor(frame.cursor, "frame");
      const expected = this.#cursor + 1;
      if (frame.cursor !== expected) {
        throw new Error(
          `Replicated state source cursor has a gap: expected ${expected}, received ${frame.cursor}`,
        );
      }
      this.#cursor = frame.cursor;
      this.#publisher.publish(frame.value, frame.context);
    } catch (error) {
      this.#fail(toError(error));
    }
  }

  #fail(error: Error): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#attachment.dispose();
    } catch (disposeError) {
      this.#report(
        new AggregateError([error, disposeError], "Replicated state source contract failed"),
      );
      return;
    }
    this.#report(error);
  }

  #report(error: unknown): void {
    try {
      this.#reportError(toError(error));
    } catch (reportError) {
      reportErrorAsync(toError(reportError));
    }
  }
}

export function attachReplicatedStateSource<T>(
  source: ReplicatedStateSource<T>,
  options: ReplicatedStateSourceOptions = {},
): AttachedReplicatedState<T> {
  const attachment = source.attach();
  try {
    const state = new AttachedReplicatedStateImpl(attachment, options);
    state.activate();
    return state;
  } catch (error) {
    try {
      attachment.dispose();
    } catch (disposeError) {
      throw new AggregateError([error, disposeError], "Failed to attach replicated state source", {
        cause: disposeError,
      });
    }
    throw error;
  }
}

function assertCursor(cursor: number, kind: "snapshot" | "frame"): void {
  if (!Number.isSafeInteger(cursor))
    throw new TypeError(`Replicated state source ${kind} cursor must be a safe integer`);
}
