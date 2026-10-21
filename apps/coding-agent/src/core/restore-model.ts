import type aiTypes from "@msa/ai/index.types";
import chalk from "chalk";
import * as Effect from "effect/Effect";

import modelResolver from "./model-resolver.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import platform from "./platform.ts";

const { writeError, writeLog } = platform;
const { preferredAvailableModel } = modelResolver;

type RestoredModel = {
  model: aiTypes.Model<aiTypes.Api> | undefined;
  fallbackMessage: string | undefined;
};

const fallBackTo = (
  model: aiTypes.Model<aiTypes.Api>,
  saved: string,
  reason: string,
  shouldPrintMessages: boolean,
): RestoredModel => {
  if (shouldPrintMessages) {
    writeLog(chalk.dim(`Falling back to: ${model.provider}/${model.id}`));
  }
  return {
    fallbackMessage: `Could not restore model ${saved} (${reason}). Using ${model.provider}/${model.id}.`,
    model,
  };
};

const pickRestoredModel = (
  savedProvider: string,
  savedModelId: string,
  currentModel: aiTypes.Model<aiTypes.Api> | undefined,
  shouldPrintMessages: boolean,
  modelRuntime: modelRuntimeTypes.ModelRuntime,
): RestoredModel => {
  const saved = `${savedProvider}/${savedModelId}`;
  const restoredModel = modelRuntime.getModel(savedProvider, savedModelId);
  if (restoredModel !== undefined && modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
    if (shouldPrintMessages) writeLog(chalk.dim(`Restored model: ${saved}`));
    return { fallbackMessage: undefined, model: restoredModel };
  }

  const reason = restoredModel === undefined ? "model no longer exists" : "no auth configured";
  if (shouldPrintMessages) {
    writeError(chalk.yellow(`Warning: Could not restore model ${saved} (${reason}).`));
  }
  const fallback =
    currentModel ?? preferredAvailableModel([...modelRuntime.getAvailableSnapshot()]);
  return fallback === undefined
    ? { fallbackMessage: undefined, model: undefined }
    : fallBackTo(fallback, saved, reason, shouldPrintMessages);
};

function restoreModelFromSession(
  savedProvider: string,
  savedModelId: string,
  currentModel: aiTypes.Model<aiTypes.Api> | undefined,
  shouldPrintMessages: boolean,
  modelRuntime: modelRuntimeTypes.ModelRuntime,
): Promise<RestoredModel> {
  return Effect.runPromise(
    Effect.sync(() =>
      pickRestoredModel(
        savedProvider,
        savedModelId,
        currentModel,
        shouldPrintMessages,
        modelRuntime,
      ),
    ),
  );
}

const restoreModel = { restoreModelFromSession };

export default restoreModel;
