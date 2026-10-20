import type aiTypes from "@msa/ai/index.types";
import chalk from "chalk";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import modelResolverPart2 from "./model-resolver-part2.ts";
import type modelResolverTypes from "./model-resolver.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import platform from "./platform.ts";

const { awaited, awaiting } = awaitingModule;
const { writeWarn } = platform;
const { resolveModelScopeFromModels } = modelResolverPart2;

function resolveModelScopeWithDiagnostics(
  patterns: string[],
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  options?: aiTypes.AuthOperationOptions,
): Promise<modelResolverTypes.ResolveModelScopeResult> {
  return Effect.runPromise(
    awaiting(function* () {
      return resolveModelScopeFromModels(
        patterns,
        yield* awaited(modelRuntime.getAvailable(undefined, options)),
      );
    }),
  );
}

function resolveModelScope(
  patterns: string[],
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  options?: aiTypes.AuthOperationOptions,
): Promise<modelResolverTypes.ScopedModel[]> {
  return Effect.runPromise(
    awaiting(function* () {
      const { scopedModels, diagnostics } = yield* awaited(
        resolveModelScopeWithDiagnostics(patterns, modelRuntime, options),
      );
      for (const diagnostic of diagnostics) {
        writeWarn(chalk.yellow(`Warning: ${diagnostic.message}`));
      }
      return scopedModels;
    }),
  );
}

const modelResolverPart3 = {
  resolveModelScope,
  resolveModelScopeWithDiagnostics,
};

export default modelResolverPart3;
