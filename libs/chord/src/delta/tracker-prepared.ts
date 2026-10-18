import { abortContext } from "./tracker-paths.ts";
import { type Op, type OverlayContext, PREPARED, type Prepared } from "./tracker-types.ts";

export class PreparedImpl<T extends object> implements Prepared<T> {
  readonly #context: OverlayContext;
  readonly value: T;
  readonly base: T;
  readonly ops: readonly Op[];

  constructor(context: OverlayContext, value: T, operations: readonly Op[]) {
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
    abortContext(this.#context);
  }
}
