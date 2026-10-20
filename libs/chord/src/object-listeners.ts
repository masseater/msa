import { Effect } from "effect";

import type coreTypes from "./core.types.ts";
import type ctxTypes from "./ctx.types.ts";
import type declareTypes from "./declare.ts";
import type declsTypes from "./decls.types.ts";
import errorsModule from "./errors.ts";
import type objectTypes from "./object.types.ts";
import publish from "./publish.ts";
import resourceModule from "./resource.ts";
import serviceModule from "./service.ts";

const { resourceOf } = resourceModule;
const { invalid } = errorsModule;
const { enqueue } = publish;
const { isStateLike } = serviceModule;

const noop = (): void => {};

const sameSelect = (
  a: declareTypes.ListenerDecl["select"],
  b: declareTypes.ListenerDecl["select"],
): boolean => a === b || (a !== undefined && b !== undefined && String(a) === String(b));

type Fresh = coreTypes.Subscription & { buffer: unknown[] | undefined; subscribe?: () => void };

const listenSource = (
  key: string,
  decl: declareTypes.ListenerDecl,
): declareTypes.Subscribable<unknown> => {
  const resource = resourceOf(decl.source);
  const value = resource === undefined ? decl.source : resource.value;
  const source = (
    decl.select === undefined ? value : decl.select(value as never)
  ) as declareTypes.Subscribable<unknown>;
  if (typeof source?.subscribe !== "function")
    throw invalid("implementation", `listener ${key}: source has no subscribe()`);
  return source;
};

export default class ObjectListeners {
  readonly #object: objectTypes.ObjectImpl;
  readonly #subscriptions = new Map<string, coreTypes.Subscription>();

  constructor(object: objectTypes.ObjectImpl) {
    this.#object = object;
  }

  stage(decls: declsTypes.Decls): coreTypes.StagedListeners {
    const fresh = new Map<string, Fresh>();
    const kept = new Set<string>();
    try {
      for (const [key, decl] of decls.listeners) {
        const origin = resourceOf(decl.source) ?? decl.source;
        const previous = this.#subscriptions.get(key);
        if (
          previous !== undefined &&
          previous.origin === origin &&
          sameSelect(previous.select, decl.select)
        ) {
          kept.add(key);
          continue;
        }
        fresh.set(key, this.#subscribe(key, decl, origin));
      }
    } catch (error) {
      for (const entry of fresh.values()) entry.unsubscribe();
      throw error;
    }
    return {
      activate: () => this.#activate(fresh, kept),
      discard: () => {
        for (const entry of fresh.values()) entry.unsubscribe();
      },
    };
  }

  stop(): void {
    for (const subscription of this.#subscriptions.values()) subscription.unsubscribe();
    this.#subscriptions.clear();
  }

  deliver(key: string, event: unknown): void {
    const object = this.#object;
    enqueue(() => {
      if (object.gate !== undefined) {
        object.gate.queue.push({ event, key });
        return;
      }
      const decl = object.decls.listeners.get(key);
      if (decl === undefined || (object.status !== "live" && object.status !== "activating"))
        return;
      const invocation = object.host.root((root) => {
        object.calls.lease(root);
        const child = (root as ctxTypes.CtxImpl).child(object);
        return object.calls.invoke(() =>
          Effect.runPromise(
            Effect.promise(() => Promise.resolve(decl.fn(event, child))).pipe(
              Effect.ensuring(Effect.sync(() => child.close())),
            ),
          ),
        );
      });
      invocation.catch((error: unknown) => object.host.report(error));
    });
  }

  #subscribe(key: string, decl: declareTypes.ListenerDecl, origin: unknown): Fresh {
    const source = listenSource(key, decl);
    const entry: Fresh = { buffer: [], origin, select: decl.select, unsubscribe: noop };
    if (isStateLike(source)) {
      entry.buffer = undefined;
      entry.subscribe = () => {
        entry.unsubscribe = source.subscribe((event) => this.deliver(key, event));
      };
      return entry;
    }
    entry.unsubscribe = source.subscribe((event) => {
      if (entry.buffer === undefined) this.deliver(key, event);
      else entry.buffer.push(event);
    });
    return entry;
  }

  #activate(fresh: ReadonlyMap<string, Fresh>, kept: ReadonlySet<string>): void {
    for (const [key, subscription] of this.#subscriptions) {
      if (kept.has(key)) continue;
      subscription.unsubscribe();
      this.#subscriptions.delete(key);
    }
    for (const [key, entry] of fresh) {
      this.#subscriptions.set(key, entry);
      entry.subscribe?.();
      const buffered = entry.buffer ?? [];
      entry.buffer = undefined;
      for (const event of buffered) this.deliver(key, event);
    }
  }
}
