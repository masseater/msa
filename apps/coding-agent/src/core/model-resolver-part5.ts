import type aiTypes from "@msa/ai/index.types";
import type typesModulePart1 from "@msa/ai/types-part1.types";
import chalk from "chalk";
import * as Effect from "effect/Effect";

import modelResolverPart1 from "./model-resolver-part1.ts";
import modelResolverPart4 from "./model-resolver-part4.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import platform from "./platform.ts";

const { writeError, writeLog } = platform;
const { defaultModelPerProvider } = modelResolverPart1;
const { restoreModelFromSessionPart5 } = modelResolverPart4;

function restoreModelFromSession(
  savedProvider: string,
  savedModelId: string,
  currentModel: aiTypes.Model<aiTypes.Api> | undefined,
  shouldPrintMessages: boolean,
  modelRuntime: modelRuntimeTypes.ModelRuntime,
): Promise<{ model: aiTypes.Model<aiTypes.Api> | undefined; fallbackMessage: string | undefined }> {
  return Effect.runPromise(
    Effect.sync(() => {
      const { restoredModel, hasConfiguredAuth } = restoreModelFromSessionPart5(
        modelRuntime,
        savedProvider,
        savedModelId,
      );

      if (restoredModel !== undefined && hasConfiguredAuth) {
        if (shouldPrintMessages) {
          writeLog(chalk.dim(`Restored model: ${savedProvider}/${savedModelId}`));
        }
        return { fallbackMessage: undefined, model: restoredModel };
      }

      const reason = restoreModelFromSessionPart2(
        restoredModel,
        shouldPrintMessages,
        savedProvider,
        savedModelId,
      );

      if (currentModel !== undefined) {
        if (shouldPrintMessages) {
          writeLog(chalk.dim(`Falling back to: ${currentModel.provider}/${currentModel.id}`));
        }
        return {
          fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${currentModel.provider}/${currentModel.id}.`,
          model: currentModel,
        };
      }

      const availableModels = [...modelRuntime.getAvailableSnapshot()];

      const firstAvailableModel = availableModels[0];
      if (firstAvailableModel !== undefined) {
        return restoreModelFromSessionPart7(
          availableModels,
          firstAvailableModel,
          shouldPrintMessages,
          savedProvider,
          savedModelId,
          reason,
        );
      }

      return { fallbackMessage: undefined, model: undefined };
    }),
  );
}

function restoreModelFromSessionPart7(
  availableModels: aiTypes.Model<typesModulePart1.Api>[],
  firstAvailableModel: aiTypes.Model<typesModulePart1.Api>,
  shouldPrintMessages: boolean,
  savedProvider: string,
  savedModelId: string,
  reason: string,
):
  | { fallbackMessage: string; model: aiTypes.Model<typesModulePart1.Api> }
  | { fallbackMessage: undefined; model: aiTypes.Model<typesModulePart1.Api> }
  | { fallbackMessage: undefined; model: undefined } {
  return restoreModelFromSessionPart6(
    availableModels,
    firstAvailableModel,
    shouldPrintMessages,
    savedProvider,
    savedModelId,
    reason,
  );
}

function restoreModelFromSessionPart6(
  availableModels: aiTypes.Model<typesModulePart1.Api>[],
  firstAvailableModel: aiTypes.Model<typesModulePart1.Api>,
  shouldPrintMessages: boolean,
  savedProvider: string,
  savedModelId: string,
  reason: string,
):
  | { fallbackMessage: string; model: aiTypes.Model<typesModulePart1.Api> }
  | { fallbackMessage: undefined; model: aiTypes.Model<typesModulePart1.Api> }
  | { fallbackMessage: undefined; model: undefined } {
  return restoreModelFromSessionPart4(
    availableModels,
    firstAvailableModel,
    shouldPrintMessages,
    savedProvider,
    savedModelId,
    reason,
  );
}

function restoreModelFromSessionPart4(
  availableModels: aiTypes.Model<typesModulePart1.Api>[],
  firstAvailableModel: aiTypes.Model<typesModulePart1.Api>,
  shouldPrintMessages: boolean,
  savedProvider: string,
  savedModelId: string,
  reason: string,
) {
  return restoreModelFromSessionPart3(
    availableModels,
    firstAvailableModel,
    shouldPrintMessages,
    savedProvider,
    savedModelId,
    reason,
  );
}

function restoreModelFromSessionPart3(
  availableModels: aiTypes.Model<typesModulePart1.Api>[],
  firstAvailableModel: aiTypes.Model<typesModulePart1.Api>,
  shouldPrintMessages: boolean,
  savedProvider: string,
  savedModelId: string,
  reason: string,
) {
  return restoreModelFromSessionPart1(
    availableModels,
    firstAvailableModel,
    shouldPrintMessages,
    savedProvider,
    savedModelId,
    reason,
  );
}

function restoreModelFromSessionPart2(
  restoredModel: aiTypes.Model<typesModulePart1.Api> | undefined,
  shouldPrintMessages: boolean,
  savedProvider: string,
  savedModelId: string,
) {
  const reason = restoredModel === undefined ? "model no longer exists" : "no auth configured";

  if (shouldPrintMessages) {
    writeError(
      chalk.yellow(
        `Warning: Could not restore model ${savedProvider}/${savedModelId} (${reason}).`,
      ),
    );
  }
  return reason;
}

function restoreModelFromSessionPart1(
  availableModels: aiTypes.Model<typesModulePart1.Api>[],
  firstAvailableModel: aiTypes.Model<typesModulePart1.Api>,
  shouldPrintMessages: boolean,
  savedProvider: string,
  savedModelId: string,
  reason: string,
) {
  let fallbackModel: aiTypes.Model<aiTypes.Api> | undefined;
  for (const provider of Object.keys(defaultModelPerProvider) as aiTypes.KnownProvider[]) {
    const defaultId = defaultModelPerProvider[provider];
    const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
    if (match !== undefined) {
      fallbackModel = match;
      break;
    }
  }

  if (fallbackModel === undefined) {
    fallbackModel = firstAvailableModel;
  }

  if (shouldPrintMessages) {
    writeLog(chalk.dim(`Falling back to: ${fallbackModel.provider}/${fallbackModel.id}`));
  }
  return {
    fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${fallbackModel.provider}/${fallbackModel.id}.`,
    model: fallbackModel,
  };
}

const modelResolverPart5 = {
  restoreModelFromSession,
};

export default modelResolverPart5;
