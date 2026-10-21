import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import type configTypes from "../config.types.ts";
import awaitingModule from "../core/awaiting.ts";
import platform from "../core/platform/index.ts";
import childProcess from "../utils/child-process.ts";
import interop from "../utils/interop.ts";
import windowsSelfUpdate from "../utils/windows-self-update.ts";
import selfUpdatePlanModule from "./self-update-plan.ts";

const {
  getSelfUpdateCommand,
  detectInstallMethod,
  getPackageDir,
  VERSION,
  getSelfUpdateUnavailableInstruction,
  APP_NAME,
  PACKAGE_NAME,
} = config;
const { spawnProcess } = childProcess;
const { callbackPromise } = interop;
const { quarantineWindowsNativeDependencies, cleanupWindowsSelfUpdateQuarantine } =
  windowsSelfUpdate;
const { writeError, writeLog } = platform;
const { awaited, awaiting } = awaitingModule;

const { getSelfUpdatePlan } = selfUpdatePlanModule;

function printSelfUpdateUnavailable(instruction: string): void {
  writeError(`error: ${APP_NAME} cannot self-update this installation.`);
  writeError(instruction);

  const entrypoint = process.argv[1];
  if (entrypoint !== undefined && entrypoint !== "") {
    writeError("");
    writeError(`Location of ${APP_NAME} executable: ${entrypoint}`);
  }
}

function prepareWindowsNpmSelfUpdate(): Promise<void> {
  if (process.platform !== "win32") {
    return Effect.runPromise(Effect.void);
  }

  const packageDir = getPackageDir();
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(cleanupWindowsSelfUpdateQuarantine(packageDir));
      yield* awaited(quarantineWindowsNativeDependencies(packageDir));
    }),
  );
}

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

function* resolveSelfUpdateCommand(
  npmCommand: string[] | undefined,
  target: configTypes.SelfUpdatePackageTarget,
): Generator<Effect.Effect<unknown>, configTypes.SelfUpdateCommand | undefined, unknown> {
  const command = yield* awaited(getSelfUpdateCommand(PACKAGE_NAME, npmCommand, target));
  if (command === undefined)
    printSelfUpdateUnavailable(
      yield* awaited(getSelfUpdateUnavailableInstruction(PACKAGE_NAME, npmCommand, target)),
    );
  return command;
}

function* performSelfUpdate(
  force: boolean,
  npmCommand: string[] | undefined,
): Generator<Effect.Effect<unknown>, void, unknown> {
  const selfUpdatePlan = yield* awaited(getSelfUpdatePlan(force));
  if (!selfUpdatePlan.shouldRun) return;

  const installMethod = detectInstallMethod();
  if (process.platform === "win32" && installMethod !== "npm" && installMethod !== "pnpm") {
    writeError(
      chalk.red(`${APP_NAME} self-update on Windows is only supported for npm and pnpm installs.`),
    );
    writeError(
      chalk.dim(`Detected install method: ${installMethod}. Update ${APP_NAME} manually.`),
    );
    process.exitCode = 1;
    return;
  }
  const selfUpdateTarget = {
    installSpec: selfUpdatePlan.installSpec,
    packageName: PACKAGE_NAME,
  };
  const selfUpdateCommand = yield* resolveSelfUpdateCommand(npmCommand, selfUpdateTarget);
  if (selfUpdateCommand === undefined) {
    process.exitCode = 1;
    return;
  }
  try {
    if (installMethod === "npm") {
      yield* awaited(prepareWindowsNpmSelfUpdate());
    }
    yield* awaited(runSelfUpdate(selfUpdateCommand));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown package command error";
    writeError(chalk.red(`Error: ${message}`));
    if (installMethod === "pnpm") {
      printPnpmSelfUpdateMetadataHint();
    }
    printSelfUpdateFallback(selfUpdateCommand);
    process.exitCode = 1;
    return;
  }
  writeLog(chalk.green(`Updated ${APP_NAME} from ${VERSION} to ${selfUpdatePlan.version}`));
}

const selfUpdate = { performSelfUpdate };

export default selfUpdate;
