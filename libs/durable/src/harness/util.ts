import type { Context } from "@msa/chord";

import { SessionFailed } from "../errors.ts";
import type { Cursor, Page } from "../types.ts";

export class Waiters<K, T> {
  readonly #sets = new Map<K, Set<PromiseWithResolvers<T>>>();

  add(key: K, context: Context): Promise<T> {
    const signal = context.abortSignal;
    if (signal?.aborted) return Promise.reject(signal.reason);
    const waiter = Promise.withResolvers<T>();
    const set = this.#sets.get(key) ?? new Set();
    this.#sets.set(key, set.add(waiter));
    if (signal !== undefined) {
      const onAbort = (): void => {
        set.delete(waiter);
        if (set.size === 0 && this.#sets.get(key) === set) this.#sets.delete(key);
        waiter.reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const detach = (): void => signal.removeEventListener("abort", onAbort);
      waiter.promise.then(detach, detach);
    }
    return waiter.promise;
  }

  keys(): K[] {
    return [...this.#sets.keys()];
  }

  resolve(key: K, value: T): void {
    const set = this.#sets.get(key);
    this.#sets.delete(key);
    for (const waiter of set ?? []) waiter.resolve(value);
  }

  rejectAll(error: unknown): void {
    const sets = [...this.#sets.values()];
    this.#sets.clear();
    for (const set of sets) for (const waiter of set) waiter.reject(error);
  }
}

export function scanAll<T>(
  scan: (cursor: Cursor | undefined) => Promise<Page<T, Cursor>>,
): Promise<T[]> {
  const items: T[] = [];
  const scanFrom = async (cursor: Cursor | undefined): Promise<T[]> => {
    const page = await scan(cursor);
    items.push(...page.items);
    return page.next === undefined ? items : scanFrom(page.next);
  };
  return scanFrom(undefined);
}

export function closedError(session: {
  readonly failure: { readonly error: unknown } | undefined;
}): Error {
  const failure = session.failure;
  return failure === undefined ? new Error("Harness is closed") : new SessionFailed(failure.error);
}
