import { ChangeImpl } from "./tracker-change.ts";
import { createContext, materializePrepared } from "./tracker-context.ts";
import { clearContext, releaseOverlayReferences } from "./tracker-paths.ts";
import {
  type Change,
  type OverlayContext,
  PREPARED,
  type Prepared,
  type Tracker,
} from "./tracker-types.ts";

export class TrackerImpl<T extends object> implements Tracker<T> {
  readonly #owner = {};
  readonly #contexts = new Set<WeakRef<OverlayContext>>();
  readonly #selfRef: WeakRef<TrackerImpl<object>>;
  #value: T;
  #revision = 0;
  #pruneBudget = 256;

  constructor(initial: T) {
    this.#value = initial;
    this.#selfRef = new WeakRef(this as unknown as TrackerImpl<object>);
  }

  get value(): T {
    return this.#value;
  }

  get revision(): number {
    return this.#revision;
  }

  beginChange(): Change<T> {
    const context = createContext(
      this.#selfRef,
      this.#owner,
      this.#revision,
      this.#value,
      false,
      this.#value,
    );
    this.#register(context);
    return new ChangeImpl(context);
  }

  prepareReplace(value: T): Prepared<T> {
    const context = createContext(
      this.#selfRef,
      this.#owner,
      this.#revision,
      value,
      true,
      this.#value,
    );
    context.status.value = "prepared";
    this.#register(context);
    try {
      return materializePrepared<T>(context);
    } catch (error) {
      context.status.value = "aborted";
      clearContext(context);
      throw error;
    }
  }

  adopt(prepared: Prepared<T>): void {
    const context = PREPARED.get(prepared as object);
    if (context?.owner !== this.#owner)
      throw new Error("Prepared change belongs to a different tracker");
    if (context.status.value === "consumed")
      throw new Error("Prepared change has already been used");
    if (context.status.value === "aborted") throw new Error("Prepared change has been aborted");
    if (context.status.value === "stale") throw new Error("Prepared change is stale");
    if (context.status.value !== "prepared") throw new Error("Prepared change is not ready");
    if (context.baseRevision !== this.#revision) {
      context.status.value = "stale";
      clearContext(context);
      throw new Error("Prepared change is stale");
    }

    if (this.#value !== prepared.base) {
      context.status.value = "stale";
      throw new Error("Prepared change is stale");
    }
    this.#value = prepared.value;
    context.status.value = "consumed";
    this.#revision += 1;
    this.#invalidate(context);
  }

  releaseContext(context: OverlayContext): void {
    if (context.registryRef !== undefined) this.#contexts.delete(context.registryRef);
    context.registryRef = undefined;
  }

  #register(context: OverlayContext): void {
    const reference = new WeakRef(context);
    context.registryRef = reference;
    this.#contexts.add(reference);
    this.#pruneBudget -= 1;
    if (this.#pruneBudget === 0) {
      this.#prune();
      this.#pruneBudget = Math.max(256, this.#contexts.size);
    }
  }

  #prune(): void {
    for (const reference of this.#contexts) {
      if (reference.deref() === undefined) this.#contexts.delete(reference);
    }
  }

  #invalidate(winner: OverlayContext): void {
    for (const reference of this.#contexts) {
      const context = reference.deref();
      if (context === undefined || context === winner) continue;
      if (context.status.value === "open" || context.status.value === "prepared")
        context.status.value = "stale";
      releaseOverlayReferences(context);
    }
    this.#contexts.clear();
    this.#pruneBudget = 256;
  }

  replacementBase(context: OverlayContext): T | undefined {
    return context.baseRevision === this.#revision ? this.#value : undefined;
  }
}
