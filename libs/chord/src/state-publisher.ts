import { BACKGROUND_CONTEXT, type Context } from "./context/index.ts";
import { reportErrorAsync } from "./state-report.ts";
import { StateSubscriber } from "./state-subscriber.ts";
import type { StateListener } from "./state-types.ts";

type Publication<T> = {
  readonly value: T;
  readonly sequence: number;
  readonly context: Context;
};

export class ReplicatedStatePublisher<T> {
  readonly #listeners = new Map<StateSubscriber<T>, number>();
  readonly #reportError: (error: Error) => void;
  readonly #publications: Publication<T>[] = [];
  #value: T;
  #sequence = 0;
  #delivering = false;

  constructor(initial: T, reportError: (error: Error) => void = reportErrorAsync) {
    this.#value = initial;
    this.#reportError = reportError;
  }

  get value(): T {
    return this.#value;
  }

  snapshot(): { readonly value: T; readonly sequence: number } {
    return { value: this.#value, sequence: this.#sequence };
  }

  subscribe(listener: StateListener<T>): () => void {
    const { value, sequence } = this.snapshot();
    const subscriber = new StateSubscriber(listener, this.#reportError);
    this.#listeners.set(subscriber, sequence);
    subscriber.push({
      value,
      context: BACKGROUND_CONTEXT,
      delivery: { kind: "hydrate", sequence },
    });
    subscriber.drain();
    return () => {
      subscriber.close();
      this.#listeners.delete(subscriber);
    };
  }

  publish(value: T, context: Context): void {
    this.#value = value;
    this.#sequence += 1;
    this.#publications.push({ value, sequence: this.#sequence, context });
    if (this.#delivering) return;

    this.#delivering = true;
    try {
      for (
        let publication = this.#publications.shift();
        publication !== undefined;
        publication = this.#publications.shift()
      ) {
        const delivery = { kind: "update", sequence: publication.sequence } as const;
        for (const [subscriber, hydratedSequence] of [...this.#listeners]) {
          if (publication.sequence <= hydratedSequence) continue;
          subscriber.push({ value: publication.value, context: publication.context, delivery });
          subscriber.drain();
        }
      }
    } finally {
      this.#delivering = false;
    }
  }
}
