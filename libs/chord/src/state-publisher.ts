import contextModule from "./context/index.ts";
import type contextTypes from "./context/index.types.ts";
import stateReport from "./state-report.ts";
import StateSubscriber from "./state-subscriber.ts";
import type stateSubscriberTypes from "./state-subscriber.types.ts";
import type stateTypesModule from "./state-types.ts";

const { reportErrorAsync } = stateReport;

const { BACKGROUND_CONTEXT } = contextModule;

type Publication<T> = {
  readonly value: T;
  readonly sequence: number;
  readonly context: contextTypes.Context;
};

export default class ReplicatedStatePublisher<T> {
  readonly #listeners = new Map<stateSubscriberTypes.StateSubscriber<T>, number>();
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
    return { sequence: this.#sequence, value: this.#value };
  }

  subscribe(listener: stateTypesModule.StateListener<T>): () => void {
    const { value, sequence } = this.snapshot();
    const subscriber = new StateSubscriber(listener, this.#reportError);
    this.#listeners.set(subscriber, sequence);
    subscriber.push({
      context: BACKGROUND_CONTEXT,
      delivery: { kind: "hydrate", sequence },
      value,
    });
    subscriber.drain();
    return () => {
      subscriber.close();
      this.#listeners.delete(subscriber);
    };
  }

  publish(value: T, context: contextTypes.Context): void {
    this.#value = value;
    this.#sequence += 1;
    this.#publications.push({ context, sequence: this.#sequence, value });
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
          subscriber.push({ context: publication.context, delivery, value: publication.value });
          subscriber.drain();
        }
      }
    } finally {
      this.#delivering = false;
    }
  }
}
