import chalk from "chalk";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import awaitingModule from "../core/awaiting.ts";
import platformModule from "../core/platform.ts";
import type packageManagerCliInternalTypes from "../package-manager-cli-internal.types.ts";
import versionCheck from "../utils/version-check.ts";
import type versionCheckTypes from "../utils/version-check.types.ts";

const { VERSION, APP_NAME, PACKAGE_NAME } = config;
const { writeLog } = platformModule;
const { isNewerPackageVersion, formatVersionCheckError, getLatestMsaRelease } = versionCheck;
const { awaited, awaiting } = awaitingModule;

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

const selfUpdatePlan = { getSelfUpdatePlan };

export default selfUpdatePlan;
