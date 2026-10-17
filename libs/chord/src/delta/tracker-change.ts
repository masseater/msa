import { type Draft } from "./draft.ts";
import { assertWritable, materializePrepared } from "./tracker-context.ts";
import { emitOperations } from "./tracker-emit.ts";
import { abortContext, clearContext } from "./tracker-paths.ts";
import {
  type Change,
  type OverlayContext,
  type Prepared,
  type StatusCell,
} from "./tracker-types.ts";

export class ChangeImpl<T extends object> implements Change<T> {
  #context: OverlayContext | undefined;
  #preparedStatus: StatusCell | undefined;
  #settled = false;

  constructor(context: OverlayContext) {
    this.#context = context;
  }

  get state(): Draft<T> {
    const state = this.#context?.root?.proxy;
    if (state === undefined) throw new TypeError("Cannot use a settled overlay");
    return state as Draft<T>;
  }

  prepare(): Prepared<T> {
    if (this.#settled) throw new Error("Change has already been settled");
    const context = this.#context!;
    assertWritable(context);
    context.status.value = "prepared";
    try {
      if (!context.replacement)
        context.ops = context.dirty.length === 0 ? [] : emitOperations(context);
      const prepared = materializePrepared<T>(context);
      this.#preparedStatus = context.status;
      this.#settled = true;
      return prepared;
    } catch (error) {
      context.status.value = "aborted";
      clearContext(context);
      this.#settled = true;
      throw error;
    } finally {
      this.#context = undefined;
    }
  }

  abort(): void {
    if (this.#settled) {
      if (this.#preparedStatus?.value === "prepared") this.#preparedStatus.value = "aborted";
      this.#preparedStatus = undefined;
      return;
    }
    this.#settled = true;
    abortContext(this.#context!);
    this.#context = undefined;
  }
}
