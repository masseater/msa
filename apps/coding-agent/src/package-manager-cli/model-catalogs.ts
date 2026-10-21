import chalk from "chalk";
import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import ModelRuntime from "../core/model-runtime.ts";
import platform from "../core/platform/index.ts";

const { join, writeError, writeLog } = platform;
const { awaited, awaiting } = awaitingModule;

import srcConfig from "../config.ts";

const { getAgentDir } = srcConfig;

function refreshModelCatalogs(agentDir: string): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const signal = AbortSignal.timeout(15_000);
      const modelRuntime = yield* awaited(
        ModelRuntime.create({
          allowModelNetwork: false,
          authPath: join(agentDir, "auth.json"),
          modelsPath: join(agentDir, "models.json"),
          signal,
        }),
      );
      const result = yield* awaited(
        modelRuntime.refresh({
          allowNetwork: true,
          force: true,
          signal,
        }),
      );
      if (result.aborted) {
        throw new Error("Model catalog refresh timed out.");
      }
      if (result.errors.size > 0) {
        const details = Array.from(
          result.errors,
          ([provider, error]) => `${provider}: ${error.message}`,
        ).join("; ");
        throw new Error(`Could not refresh model catalogs: ${details}`);
      }
      writeLog(chalk.green("Model catalogs refreshed"));
    }),
  );
}

function refreshModels(): Promise<void> {
  return refreshModelCatalogs(getAgentDir()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown model catalog refresh error";
    writeError(chalk.red(`Error: ${message}`));
    process.exitCode = 1;
  });
}

const modelCatalogs = { refreshModels };

export default modelCatalogs;
