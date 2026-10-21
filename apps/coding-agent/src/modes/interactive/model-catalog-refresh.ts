import type aiTypes from "@msa/ai/index.types";
import { dual } from "effect/Function";

import type modelRuntimeTypes from "../../core/model-runtime.types.ts";
import abortModule from "../../utils/abort.ts";

const { raceWithAbortSignal } = abortModule;

type ModelCatalogRuntime = Pick<modelRuntimeTypes.ModelRuntime, "refresh">;

interface ActiveModelCatalogRefresh {
  controller: AbortController;
  promise: Promise<aiTypes.ModelsRefreshResult>;
  waiters: number;
}

class ModelCatalogRefreshCoordinator {
  private readonly activeByRuntime = new WeakMap<ModelCatalogRuntime, ActiveModelCatalogRefresh>();

  refresh(
    modelRuntime: ModelCatalogRuntime,
    signal: AbortSignal,
  ): Promise<aiTypes.ModelsRefreshResult> {
    signal.throwIfAborted();
    let active = this.activeByRuntime.get(modelRuntime);
    if (active === undefined) {
      const controller = new AbortController();
      let created!: ActiveModelCatalogRefresh;
      const operation = modelRuntime.refresh({ signal: controller.signal });
      const promise = raceWithAbortSignal(operation, controller.signal).finally(() => {
        if (this.activeByRuntime.get(modelRuntime) === created) {
          this.activeByRuntime.delete(modelRuntime);
        }
      });
      created = { controller, promise, waiters: 0 };
      active = created;
      this.activeByRuntime.set(modelRuntime, active);
    }

    active.waiters++;
    return raceWithAbortSignal(active.promise, signal).finally(() => {
      active.waiters--;
      if (active.waiters === 0 && this.activeByRuntime.get(modelRuntime) === active) {
        active.controller.abort();
      }
    });
  }
}

const modelCatalogRefreshCoordinator = new ModelCatalogRefreshCoordinator();

const refreshModelCatalogs: {
  (
    signal: AbortSignal,
  ): (modelRuntime: ModelCatalogRuntime) => Promise<aiTypes.ModelsRefreshResult>;
  (modelRuntime: ModelCatalogRuntime, signal: AbortSignal): Promise<aiTypes.ModelsRefreshResult>;
} = dual(
  2,
  (modelRuntime: ModelCatalogRuntime, signal: AbortSignal): Promise<aiTypes.ModelsRefreshResult> =>
    modelCatalogRefreshCoordinator.refresh(modelRuntime, signal),
);

const modelCatalogRefresh = {
  refreshModelCatalogs,
};

export default modelCatalogRefresh;
