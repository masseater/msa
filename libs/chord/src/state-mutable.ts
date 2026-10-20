import type contextTypes from "./context/index.types.ts";
import tracker from "./delta/tracker.ts";
import type trackerTypes from "./delta/tracker.types.ts";
import ReplicatedStatePublisher from "./state-publisher.ts";
import type statePublisherTypes from "./state-publisher.types.ts";
import stateReport from "./state-report.ts";
import type stateTypesModule from "./state-types.ts";

const { track } = tracker;

const { isPromiseLike } = stateReport;

export default class MutableReplicatedStateImpl<
  T extends object,
> implements stateTypesModule.MutableReplicatedState<T> {
  readonly #tracker: trackerTypes.Tracker<T>;
  readonly #publisher: statePublisherTypes.ReplicatedStatePublisher<T>;
  #changing = false;

  constructor(initial: T) {
    this.#tracker = track(initial);
    this.#publisher = new ReplicatedStatePublisher(this.#tracker.value);
  }

  get value(): T {
    return this.#tracker.value;
  }

  change(
    context: contextTypes.Context,
    mutate: Parameters<stateTypesModule.MutableReplicatedState<T>["change"]>[1],
  ): void {
    if (this.#changing)
      throw new Error("Replicated state cannot be changed reentrantly from a change callback");
    this.#changing = true;
    let prepared: trackerTypes.Prepared<T>;
    try {
      const change = this.#tracker.beginChange();
      try {
        const outcome = (mutate as (draft: typeof change.state) => unknown)(change.state);
        if (isPromiseLike(outcome)) {
          void Promise.resolve(outcome).catch(() => undefined);
          throw new TypeError("Replicated state change callbacks must be synchronous");
        }
        prepared = change.prepare();
      } catch (error) {
        change.abort();
        throw error;
      }
    } finally {
      this.#changing = false;
    }

    this.#tracker.adopt(prepared);
    if (prepared.ops.length > 0) this.#publisher.publish(prepared.value, context);
  }

  replace(context: contextTypes.Context, value: T): void {
    if (this.#changing)
      throw new Error("Replicated state cannot be replaced from a change callback");
    const prepared = this.#tracker.prepareReplace(value);
    this.#tracker.adopt(prepared);
    if (prepared.ops.length > 0) this.#publisher.publish(prepared.value, context);
  }

  subscribe(listener: stateTypesModule.StateListener<T>): () => void {
    return this.#publisher.subscribe(listener);
  }
}
