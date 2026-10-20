import { Type } from "typebox";

import { local, method } from "../../src/index.ts";

function emitter<E>(options: { failSubscribe?: boolean } = {}) {
  const listeners = new Set<(event: E) => void>();
  return {
    emit: (event: E) => {
      for (const fn of [...listeners]) fn(event);
    },
    get size() {
      return listeners.size;
    },
    subscribe: (fn: (event: E) => void) => {
      if (options.failSubscribe === true) throw new Error("subscribe fails");
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const Item = local("t.item", {
  input: Type.Object({ id: Type.String() }),
  members: { version: method(undefined, Type.String()) },
  version: 1,
});

const abortController = (): AbortController => new AbortController();

const review = {
  Item,
  abortController,
  emitter,
};

export default review;
