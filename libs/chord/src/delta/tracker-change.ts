import type draftTypes from "./draft.ts";
import trackerContext from "./tracker-context.ts";
import trackerEmit from "./tracker-emit.ts";
import trackerPaths from "./tracker-paths.ts";
import type trackerTypesModule from "./tracker-types.types.ts";

export default class ChangeImpl<T extends object> implements trackerTypesModule.Change<T> {
  #context: trackerTypesModule.OverlayContext | undefined;
  #preparedStatus: trackerTypesModule.StatusCell | undefined;
  #settled = false;

  constructor(context: trackerTypesModule.OverlayContext) {
    this.#context = context;
  }

  get state(): draftTypes.Draft<T> {
    const state = this.#context?.root?.proxy;
    if (state === undefined) throw new TypeError("Cannot use a settled overlay");
    return state as draftTypes.Draft<T>;
  }

  prepare(): trackerTypesModule.Prepared<T> {
    if (this.#settled) throw new Error("Change has already been settled");
    const context = this.#context!;
    trackerContext.assertWritable(context);
    context.status.value = "prepared";
    try {
      if (!context.replacement)
        context.ops = context.dirty.length === 0 ? [] : trackerEmit.emitOperations(context);
      const prepared = trackerContext.materializePrepared<T>(context);
      this.#preparedStatus = context.status;
      this.#settled = true;
      return prepared;
    } catch (error) {
      context.status.value = "aborted";
      trackerPaths.clearContext(context);
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
    trackerPaths.abortContext(this.#context!);
    this.#context = undefined;
  }
}
