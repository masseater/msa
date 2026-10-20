import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "./config.ts";
import awaitingModule from "./core/awaiting.ts";
import platformModule from "./core/platform.ts";
import type packageManagerCliInternalTypes from "./package-manager-cli-internal.types.ts";
import versionCheck from "./utils/version-check.ts";
import type versionCheckTypes from "./utils/version-check.types.ts";
import windowsSelfUpdate from "./utils/windows-self-update.ts";

const { awaited, awaiting } = awaitingModule;
const { formatVersionCheckError, getLatestMsaRelease, isNewerPackageVersion } = versionCheck;
const { APP_NAME, PACKAGE_NAME, VERSION, getPackageDir } = config;
const { writeLog } = platformModule;
const { cleanupWindowsSelfUpdateQuarantine, quarantineWindowsNativeDependencies } =
  windowsSelfUpdate;

function getSelfUpdatePlan(force: boolean): Promise<packageManagerCliInternalTypes.SelfUpdatePlan> {
  return Effect.runPromise(
    awaiting(function* () {
      let latestRelease: versionCheckTypes.LatestMsaRelease | undefined;
      try {
        latestRelease = yield* awaited(getLatestMsaRelease(VERSION, { retry: true }));
      } catch (error: unknown) {
        throw new Error(
          `Could not determine latest ${APP_NAME} version: ${formatVersionCheckError(error)}`,
          {
            cause: error,
          },
        );
      }
      if (latestRelease === undefined) {
        throw new Error(`Could not determine latest ${APP_NAME} version.`);
      }

      const installSpec = `${PACKAGE_NAME}@${latestRelease.version}`;
      if (force || isNewerPackageVersion(latestRelease.version, VERSION)) {
        return { installSpec, shouldRun: true, version: latestRelease.version };
      }

      writeLog(chalk.green(`${APP_NAME} is already up to date (v${VERSION})`));
      return { installSpec, shouldRun: false, version: latestRelease.version };
    }),
  );
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

const packageManagerCliPart5 = {
  getSelfUpdatePlan,
  prepareWindowsNpmSelfUpdate,
};

export default packageManagerCliPart5;
