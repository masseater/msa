import type aiTypes from "@msa/ai/index.types";
import chalk from "chalk";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type modelResolverTypes from "./model-resolver.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import modelScope from "./model-scope.ts";
import platform from "./platform/index.ts";

const { writeWarn } = platform;
const { awaited, awaiting } = awaitingModule;
const { resolveModelScopeFromModels } = modelScope;

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

const runtimeModelScope = { resolveModelScope, resolveModelScopeWithDiagnostics };

export default runtimeModelScope;
