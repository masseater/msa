import chalk from "chalk";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import authGuidance from "../core/auth-guidance.ts";
import awaitingModule from "../core/awaiting.ts";
import modelPolicy from "../core/model-policy.ts";
import type modelRuntimeTypes from "../core/model-runtime.types.ts";
import platform from "../core/platform/index.ts";
import modelTable from "./model-table.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError, writeLog } = platform;
const { formatNoModelsAvailableMessage } = authGuidance;
const { hiddenModelsByPolicy } = modelPolicy;

const { formatModelTable, matchingModels } = modelTable;

function hiddenModelsNotice(modelRuntime: modelRuntimeTypes.ModelRuntime): string | undefined {
  const hidden = hiddenModelsByPolicy(
    modelRuntime.getModelPolicy(),
    modelRuntime.getCatalogModels(),
  );
  if (hidden.length === 0) return undefined;
  const patterns = [
    ...new Set(hidden.map((entry) => (entry.pattern === "" ? "allow list" : entry.pattern))),
  ];
  return `\n${hidden.length} model${hidden.length === 1 ? "" : "s"} hidden by model policy (${patterns.join(", ")}). See /model.`;
}

function listModelsImpl(
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  searchPattern?: string,
  signal?: AbortSignal,
): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const models = yield* loadAvailableModels(modelRuntime, signal);
      if (models.length === 0) {
        writeLog(formatNoModelsAvailableMessage());
        return;
      }
      const filteredModels = matchingModels(models, searchPattern);
      if (filteredModels.length === 0) {
        writeLog(`No models matching "${searchPattern}"`);
        return;
      }
      for (const line of formatModelTable(filteredModels)) writeLog(line);
      const notice = hiddenModelsNotice(modelRuntime);
      if (notice !== undefined) writeLog(chalk.dim(notice));
    }),
  );
}

const listModels: {
  (
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    searchPattern?: string,
    signal?: AbortSignal,
  ): Promise<void>;
  (
    searchPattern?: string,
    signal?: AbortSignal,
  ): (modelRuntime: modelRuntimeTypes.ModelRuntime) => Promise<void>;
} = dual((args: IArguments) => args.length >= 1, listModelsImpl);

const listModelsModule = {
  listModels,
};

export default listModelsModule;

function* loadAvailableModels(
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  signal: AbortSignal | undefined,
) {
  const loadError = modelRuntime.getError();
  if (loadError !== undefined && loadError !== "") {
    writeError(chalk.yellow(`Warning: errors loading models.json:\n${loadError}`));
  }

  const models = [
    ...(yield* awaited(
      modelRuntime.getAvailable(undefined, signal === undefined ? {} : { signal }),
    )),
  ];
  return models;
}
