import trackerPaths from "./tracker-paths.ts";
import trackerTypes from "./tracker-types.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

const { PREPARED } = trackerTypes;

export default class PreparedImpl<T extends object> implements trackerTypesModule.Prepared<T> {
  readonly #context: trackerTypesModule.OverlayContext;
  readonly value: T;
  readonly base: T;
  readonly ops: readonly trackerTypesModule.Op[];

  constructor(
    context: trackerTypesModule.OverlayContext,
    value: T,
    operations: readonly trackerTypesModule.Op[],
  ) {
    this.#context = context;
    this.value = value;
    this.base = context.baseValue as T;
    this.ops = operations;
    PREPARED.set(this, context);
  }

  get baseRevision(): number {
    return this.#context.baseRevision;
  }

  abort(): void {
    trackerPaths.abortContext(this.#context);
  }
}
