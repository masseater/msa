import { Effect, Fiber } from "effect";

import awaitingModule from "../../../../core/awaiting.ts";
import errorsModule from "../../../../utils/errors.ts";
import modelCatalogRefresh from "../../model-catalog-refresh.ts";
import type ModelSelectorComponent from "../model-selector.ts";

const { awaited, awaiting } = awaitingModule;
const { refreshModelCatalogs } = modelCatalogRefresh;
const { toErrorMessage } = errorsModule;

export default class ModelRefresh {
  private readonly selector: ModelSelectorComponent;

  readonly abortController = new AbortController();

  private timeout: Fiber.Fiber<void> | undefined;

  closed = false;

  constructor(selector: ModelSelectorComponent) {
    this.selector = selector;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopRefreshTimeout();
    this.abortController.abort();
  }

  private stopRefreshTimeout(): void {
    const timeout = this.timeout;
    this.timeout = undefined;
    if (timeout !== undefined) Effect.runFork(Fiber.interrupt(timeout));
  }

  refreshModels(): Promise<void> {
    return Effect.runPromise(awaiting(() => this.refreshCatalog()));
  }

  private *refreshCatalog() {
    const timeoutMs = 15_000;
    let timedOut = false;
    this.timeout = Effect.runFork(
      Effect.andThen(
        Effect.sleep(timeoutMs),
        Effect.sync(() => {
          timedOut = true;
          this.abortController.abort();
        }),
      ),
    );
    try {
      const result = yield* awaited(
        refreshModelCatalogs(this.selector.modelRuntime, this.abortController.signal),
      );
      if (this.closed) return;
      this.selector.refreshStatusMessage = "";
      if (result.aborted && timedOut) {
        this.selector.errorMessage = "Model refresh timed out; showing cached models.";
      } else if (result.errors.size === 1) {
        this.selector.errorMessage = `Could not refresh ${result.errors.keys().next().value}; showing cached models.`;
      } else if (result.errors.size > 1) {
        this.selector.errorMessage = `Could not refresh ${result.errors.size} model catalogs (${[...result.errors.keys()].join(", ")}); showing cached models.`;
      } else {
        this.selector.errorMessage = this.selector.modelRuntime.getError();
        if (this.selector.errorMessage === undefined || this.selector.errorMessage === "") {
          this.selector.refreshStatusMessage = "Model catalogs refreshed.";
          this.selector.refreshStatusSuccess = true;
        }
      }
      this.selector.catalog.loadModelsFromSnapshot();
      this.selector.list.filterModels(this.selector.searchInput.getValue());
      this.selector.tui.requestRender();
    } catch (error) {
      if (this.closed) return;
      this.selector.refreshStatusMessage = "";
      this.selector.errorMessage = timedOut
        ? "Model refresh timed out; showing cached models."
        : `Could not refresh model catalogs: ${toErrorMessage(error)}`;
      this.selector.list.updateList();
      this.selector.tui.requestRender();
    } finally {
      this.stopRefreshTimeout();
    }
  }
}
