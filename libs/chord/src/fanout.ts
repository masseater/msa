import publish from "./publish.ts";
import type typesModule from "./types.types.ts";

const { enqueue } = publish;

export default class Fanout<T> {
  readonly #values = new Set<(value: T) => void>();
  readonly #events = new Set<(event: typesModule.StateEvent<T>) => void>();
  readonly #report: (error: unknown) => void;

  constructor(report: (error: unknown) => void) {
    this.#report = report;
  }

  subscribe(listener: (value: T) => void, current: T): () => void {
    this.#values.add(listener);
    this.#call(listener, current);
    return () => this.#values.delete(listener);
  }

  events(listener: (event: typesModule.StateEvent<T>) => void, current: T): () => void {
    this.#events.add(listener);
    this.#call(listener, { type: "snap", value: current });
    return () => this.#events.delete(listener);
  }

  emit(event: typesModule.StateEvent<T>): void {
    const events = [...this.#events];
    const values = [...this.#values];
    enqueue(() => {
      for (const listener of events) if (this.#events.has(listener)) this.#call(listener, event);
      for (const listener of values)
        if (this.#values.has(listener)) this.#call(listener, event.value);
    });
  }

  #call<V>(listener: (value: V) => void, value: V): void {
    try {
      listener(value);
    } catch (error) {
      this.#report(error);
    }
  }
}
