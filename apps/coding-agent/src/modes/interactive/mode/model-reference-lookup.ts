import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import modelResolver from "../../../core/model-resolver.ts";
import platformModule from "../../../core/platform.ts";
import errorsModule from "../../../utils/errors.ts";
import type InteractiveMode from "../interactive-mode.ts";
import modelCatalogRefresh from "../model-catalog-refresh.ts";

const { awaited, awaitingWith } = awaitingModule;
const { findExactModelReferenceMatch } = modelResolver;

const REFRESH_TIMEOUT_MS = 15_000;
const TIMED_OUT = "Model refresh timed out; searching cached models.";

type Model = compatTypes.Model<any>;

function cachedModels(mode: InteractiveMode): Model[] {
  const { selection } = mode.session.models;
  return selection.scopedModels.length > 0
    ? selection.scopedModels.map((scoped) => scoped.model)
    : [...selection.modelRuntime.getAvailableSnapshot()];
}

function refreshCatalogs(mode: InteractiveMode): Effect.Effect<void> {
  return awaitingWith(function* () {
    const { status } = mode.display;
    status.showStatus("Refreshing model catalogs…");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = platformModule.schedule(() => {
      timedOut = true;
      controller.abort();
    }, REFRESH_TIMEOUT_MS);
    try {
      const result = yield* awaited(
        modelCatalogRefresh.refreshModelCatalogs(
          mode.session.models.selection.modelRuntime,
          controller.signal,
        ),
      );
      if (result.aborted && timedOut) {
        status.showWarning(TIMED_OUT);
      } else if (result.errors.size > 0) {
        const failed = [...result.errors.keys()].join(", ");
        status.showWarning(`Could not refresh ${failed}; searching cached models.`);
      }
    } catch (error) {
      status.showWarning(
        timedOut
          ? TIMED_OUT
          : `Could not refresh model catalogs: ${errorsModule.toErrorMessage(error)}`,
      );
    } finally {
      timeout.cancel();
    }
  }, mode);
}

function findExactModelMatch(
  mode: InteractiveMode,
  searchTerm: string,
): Promise<Model | undefined> {
  return Effect.runPromise(
    awaitingWith(function* () {
      const cachedMatch = findExactModelReferenceMatch(searchTerm, cachedModels(mode));
      if (cachedMatch !== undefined || mode.session.models.selection.scopedModels.length > 0) {
        return cachedMatch;
      }
      yield* refreshCatalogs(mode);
      return findExactModelReferenceMatch(searchTerm, [
        ...mode.session.models.selection.modelRuntime.getAvailableSnapshot(),
      ]);
    }, mode),
  );
}

const modelReferenceLookup = {
  findExactModelMatch,
};

export default modelReferenceLookup;
