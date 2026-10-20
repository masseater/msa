import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "./config.ts";
import awaitingModule from "./core/awaiting.ts";
import platformModule from "./core/platform.ts";
import type packageManagerCliInternalTypes from "./package-manager-cli-internal.types.ts";
import packageManagerCliPart4 from "./package-manager-cli-part4.ts";
import packageManagerCliPart5 from "./package-manager-cli-part5.ts";
import packageManagerCliPart6 from "./package-manager-cli-part6.ts";

const { awaited } = awaitingModule;
const { APP_NAME, PACKAGE_NAME, VERSION, detectInstallMethod, getSelfUpdateCommand } = config;
const { writeError, writeLog } = platformModule;
const { getSelfUpdatePlan, prepareWindowsNpmSelfUpdate } = packageManagerCliPart5;
const { printSelfUpdateUnavailable } = packageManagerCliPart4;
const { printPnpmSelfUpdateMetadataHint, printSelfUpdateFallback, runSelfUpdate } =
  packageManagerCliPart6;

function* performSelfUpdate(
  force: boolean,
  npmCommand: string[] | undefined,
): Generator<Effect.Effect<unknown>, void, unknown> {
  const selfUpdatePlan = (yield* awaited(
    getSelfUpdatePlan(force),
  )) as packageManagerCliInternalTypes.SelfUpdatePlan;
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
  const selfUpdateCommand = getSelfUpdateCommand(PACKAGE_NAME, npmCommand, selfUpdateTarget);
  if (selfUpdateCommand === undefined) {
    printSelfUpdateUnavailable(npmCommand, selfUpdateTarget);
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

const packageManagerCliPart7 = {
  performSelfUpdate,
};

export default packageManagerCliPart7;
