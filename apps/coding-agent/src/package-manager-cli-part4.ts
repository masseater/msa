import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "./config.ts";
import type configTypes from "./config.types.ts";
import awaitingModule from "./core/awaiting.ts";
import ModelRuntime from "./core/model-runtime.ts";
import platformNode from "./core/platform-node.ts";
import platformModule from "./core/platform.ts";

const { awaited, awaiting } = awaitingModule;
const { join } = platformNode;
const { writeError, writeLog } = platformModule;
const { APP_NAME, PACKAGE_NAME, getSelfUpdateUnavailableInstruction } = config;

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

function printSelfUpdateUnavailable(
  npmCommand?: string[],
  updatePackageTarget: configTypes.SelfUpdatePackageTarget = PACKAGE_NAME,
): void {
  writeError(`error: ${APP_NAME} cannot self-update this installation.`);
  writeError(getSelfUpdateUnavailableInstruction(PACKAGE_NAME, npmCommand, updatePackageTarget));

  const entrypoint = process.argv[1];
  if (entrypoint !== undefined && entrypoint !== "") {
    writeError("");
    writeError(`Location of ${APP_NAME} executable: ${entrypoint}`);
  }
}

const packageManagerCliPart4 = {
  printSelfUpdateUnavailable,
  refreshModelCatalogs,
};

export default packageManagerCliPart4;
