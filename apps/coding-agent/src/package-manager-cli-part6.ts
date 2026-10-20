import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "./config.ts";
import type configTypes from "./config.types.ts";
import awaitingModule from "./core/awaiting.ts";
import platformModule from "./core/platform.ts";
import childProcess from "./utils/child-process.ts";
import interop from "./utils/interop.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError, writeLog } = platformModule;
const { APP_NAME } = config;
const { callbackPromise } = interop;
const { spawnProcess } = childProcess;

function printSelfUpdateFallback(command: configTypes.SelfUpdateCommand): void {
  writeError(chalk.dim(`If this keeps failing, run this command yourself: ${command.display}`));
}

function printPnpmSelfUpdateMetadataHint(): void {
  writeError(
    chalk.yellow(
      "If pnpm reports missing package versions, its cached registry metadata may be stale.",
    ),
  );
  writeError(chalk.yellow(`Run \`pnpm store prune\` and retry \`${APP_NAME} update --self\`.`));
}

function runSelfUpdate(command: configTypes.SelfUpdateCommand): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      writeLog(chalk.dim(`Updating ${APP_NAME} with ${command.display}...`));
      for (const step of command.steps ?? [command]) {
        yield* awaited(
          callbackPromise<void>((resolve, reject) => {
            const child = spawnProcess(step.command, step.args, {
              stdio: "inherit",
            });
            child.on("error", (error) => {
              reject(error);
            });
            child.on("close", (code, signal) => {
              if (code === 0) {
                resolve();
              } else if (signal === null) {
                reject(new Error(`${step.display} exited with code ${code ?? "unknown"}`));
              } else {
                reject(new Error(`${step.display} terminated by signal ${signal}`));
              }
            });
          }),
        );
      }
    }),
  );
}

const packageManagerCliPart6 = {
  printPnpmSelfUpdateMetadataHint,
  printSelfUpdateFallback,
  runSelfUpdate,
};

export default packageManagerCliPart6;
