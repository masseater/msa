import stateReport from "./state-report.ts";
import type stateTypesModule from "./state-types.ts";

const { isPromiseLike, reportErrorAsync, toError } = stateReport;

export default class StateSubscriber<T> {
  readonly #listener: stateTypesModule.StateListener<T>;
  readonly #reportError: (error: Error) => void;
  readonly #pending: stateTypesModule.StateDelivery<T>[] = [];
  #running = false;
  #started = false;
  #closed = false;

  constructor(listener: stateTypesModule.StateListener<T>, reportError: (error: Error) => void) {
    this.#listener = listener;
    this.#reportError = reportError;
  }

  push(frame: stateTypesModule.StateDelivery<T>): void {
    if (this.#closed) return;
    if (this.#pending.length === 100) {
      const hydration = this.#started ? undefined : this.#pending[0];
      this.#pending.length = 0;
      if (hydration !== undefined) this.#pending.push(hydration);
    }
    this.#pending.push(frame);
  }

  drain(): void {
    if (this.#running || this.#closed) return;
    this.#running = true;
    for (let frame = this.#pending.shift(); frame !== undefined; frame = this.#pending.shift()) {
      this.#started = true;
      try {
        const result: unknown = this.#listener(frame.value, frame.context, frame.delivery);
        if (isPromiseLike(result)) {
          void Promise.resolve(result).then(
            () => this.#resume(),
            (error: unknown) => {
              this.#report(error);
              this.#resume();
            },
          );
          return;
        }
      } catch (error) {
        this.#report(error);
      }
    }
    this.#running = false;
  }

  clear(): void {
    this.#pending.length = 0;
  }

  close(): void {
    this.#closed = true;
    this.clear();
  }

  #resume(): void {
    this.#running = false;
    this.drain();
  }

  #report(error: unknown): void {
    try {
      this.#reportError(toError(error));
    } catch (reportError) {
      reportErrorAsync(toError(reportError));
    }
  }
}
