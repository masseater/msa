import { Type } from "typebox";

import { local, method } from "../../src/index.ts";

export function emitter<E>(options: { failSubscribe?: boolean } = {}) {
  const listeners = new Set<(event: E) => void>();
  return {
    emit: (event: E) => {
      for (const fn of [...listeners]) fn(event);
    },
    subscribe: (fn: (event: E) => void) => {
      if (options.failSubscribe === true) throw new Error("subscribe fails");
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get size() {
      return listeners.size;
    },
  };
}

export const Item = local("t.item", {
  version: 1,
  input: Type.Object({ id: Type.String() }),
  members: { version: method(undefined, Type.String()) },
});

export const abortController = (): AbortController => new AbortController();
