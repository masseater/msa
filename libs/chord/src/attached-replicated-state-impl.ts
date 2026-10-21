import ReplicatedStatePublisher from "./state-publisher.ts";
import type statePublisherTypes from "./state-publisher.types.ts";
import stateReport from "./state-report.ts";
import type stateTypesModule from "./state-types.ts";

const { reportErrorAsync, toError } = stateReport;

function assertCursor(cursor: number, kind: "snapshot" | "frame"): void {
  if (!Number.isSafeInteger(cursor))
    throw new TypeError(`Replicated state source ${kind} cursor must be a safe integer`);
}

export default class AttachedReplicatedStateImpl<
  T,
> implements stateTypesModule.AttachedReplicatedState<T> {
  readonly #publisher: statePublisherTypes.ReplicatedStatePublisher<T>;
  readonly #attachment: stateTypesModule.ReplicatedStateSourceAttachment<T>;
  readonly #reportError: (error: Error) => void;
  #cursor: number;
  #disposed = false;

  constructor(
    attachment: stateTypesModule.ReplicatedStateSourceAttachment<T>,
    options: stateTypesModule.ReplicatedStateSourceOptions,
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

  subscribe(listener: stateTypesModule.StateListener<T>): () => void {
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

  #receive(frame: stateTypesModule.ReplicatedStateSourceFrame<T>): void {
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
