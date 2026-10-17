import type { Context } from "./context/index.ts";
import { type Prepared, type Tracker, track } from "./delta/index.ts";
import { ReplicatedStatePublisher } from "./state-publisher.ts";
import { isPromiseLike } from "./state-report.ts";
import type { MutableReplicatedState, StateListener } from "./state-types.ts";

export class MutableReplicatedStateImpl<T extends object> implements MutableReplicatedState<T> {
  readonly #tracker: Tracker<T>;
  readonly #publisher: ReplicatedStatePublisher<T>;
  #changing = false;

  constructor(initial: T) {
    this.#tracker = track(initial);
    this.#publisher = new ReplicatedStatePublisher(this.#tracker.value);
  }

  get value(): T {
    return this.#tracker.value;
  }

  change(context: Context, mutate: Parameters<MutableReplicatedState<T>["change"]>[1]): void {
    if (this.#changing)
      throw new Error("Replicated state cannot be changed reentrantly from a change callback");
    this.#changing = true;
    let prepared: Prepared<T>;
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

  replace(context: Context, value: T): void {
    if (this.#changing)
      throw new Error("Replicated state cannot be replaced from a change callback");
    const prepared = this.#tracker.prepareReplace(value);
    this.#tracker.adopt(prepared);
    if (prepared.ops.length > 0) this.#publisher.publish(prepared.value, context);
  }

  subscribe(listener: StateListener<T>): () => void {
    return this.#publisher.subscribe(listener);
  }
}
