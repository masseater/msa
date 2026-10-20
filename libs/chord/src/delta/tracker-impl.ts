import ChangeImpl from "./tracker-change.ts";
import trackerContext from "./tracker-context.ts";
import trackerPaths from "./tracker-paths.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";
const { PREPARED } = trackerTypes;

export default class TrackerImpl<T extends object> implements trackerTypesModule.Tracker<T> {
  readonly #owner = {};
  readonly #contexts = new Set<WeakRef<trackerTypesModule.OverlayContext>>();
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

  beginChange(): trackerTypesModule.Change<T> {
    const context = trackerContext.createContext(
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

  prepareReplace(value: T): trackerTypesModule.Prepared<T> {
    const context = trackerContext.createContext(
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
      return trackerContext.materializePrepared<T>(context);
    } catch (error) {
      context.status.value = "aborted";
      trackerPaths.clearContext(context);
      throw error;
    }
  }

  adopt(prepared: trackerTypesModule.Prepared<T>): void {
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
      trackerPaths.clearContext(context);
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

  releaseContext(context: trackerTypesModule.OverlayContext): void {
    if (context.registryRef !== undefined) this.#contexts.delete(context.registryRef);
    context.registryRef = undefined;
  }

  #register(context: trackerTypesModule.OverlayContext): void {
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

  #invalidate(winner: trackerTypesModule.OverlayContext): void {
    for (const reference of this.#contexts) {
      const context = reference.deref();
      if (context === undefined || context === winner) continue;
      if (context.status.value === "open" || context.status.value === "prepared")
        context.status.value = "stale";
      trackerPaths.releaseOverlayReferences(context);
    }
    this.#contexts.clear();
    this.#pruneBudget = 256;
  }

  replacementBase(context: trackerTypesModule.OverlayContext): T | undefined {
    return context.baseRevision === this.#revision ? this.#value : undefined;
  }
}
