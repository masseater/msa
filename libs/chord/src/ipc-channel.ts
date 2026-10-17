import { Effect, Queue, type Scope, type Sink, Stream } from "effect";
import { Ndjson } from "effect/encoding";

import type { IpcChannel } from "./link-ipc.ts";

type Listener = (message: unknown) => void;

export class StreamChannel implements IpcChannel {
  #connected = true;
  readonly #outbox = Effect.runSync(Queue.unbounded<unknown>());
  readonly #listeners = { message: new Set<Listener>(), disconnect: new Set<Listener>() };

  get connected(): boolean {
    return this.#connected;
  }

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    if (!this.#connected) {
      callback?.(new Error("channel disconnected"));
      return false;
    }
    Queue.offerUnsafe(this.#outbox, message);
    callback?.(null);
    return true;
  }

  on(event: "message" | "disconnect", listener: Listener): this {
    this.#listeners[event].add(listener);
    return this;
  }

  off(event: "message" | "disconnect", listener: Listener): this {
    this.#listeners[event].delete(listener);
    return this;
  }

  run<E1, E2>(
    incoming: Stream.Stream<Uint8Array, E1>,
    outgoing: Sink.Sink<unknown, Uint8Array, never, E2>,
  ): Effect.Effect<void, never, Scope.Scope> {
    const reading = incoming.pipe(
      Stream.pipeThroughChannelOrFail(Ndjson.decode({ ignoreEmptyLines: true })),
      Stream.runForEach((message) => Effect.sync(() => this.#emit("message", message))),
    );
    const writing = Stream.fromQueue(this.#outbox).pipe(
      Stream.pipeThroughChannel(Ndjson.encode()),
      Stream.run(outgoing),
    );
    return Effect.asVoid(
      Effect.forkScoped(
        Effect.raceFirst(Effect.ignore(reading), Effect.ignore(writing)).pipe(
          Effect.ensuring(Effect.sync(() => this.#disconnect())),
        ),
      ),
    );
  }

  #emit(event: "message" | "disconnect", message?: unknown): void {
    for (const listener of this.#listeners[event]) listener(message);
  }

  #disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    this.#emit("disconnect");
  }
}
