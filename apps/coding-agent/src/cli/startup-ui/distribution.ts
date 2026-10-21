import config from "../../config.ts";
import experimental from "../../core/experimental.ts";
import platformModule from "../../core/platform/index.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import type startupUiInternalTypes from "../startup-ui-internal.types.ts";

const { existsSync } = nodeFs;
const { ENV_AGENT_DIR, PACKAGE_NAME, CONFIG_DIR_NAME, APP_NAME, getSettingsPath } = config;
const { readEnv } = platformModule;
const { areExperimentalFeaturesEnabled } = experimental;

const OFFICIAL_PACKAGE_NAME = "@msa/coding-agent";

const OFFICIAL_APP_NAME = "msa";

const OFFICIAL_CONFIG_DIR_NAME = ".msa";

function isOfficialDistribution({
  packageName,
  appName,
  configDirName,
}: startupUiInternalTypes.DistributionMetadata): boolean {
  return (
    packageName === OFFICIAL_PACKAGE_NAME &&
    appName === OFFICIAL_APP_NAME &&
    configDirName === OFFICIAL_CONFIG_DIR_NAME
  );
}

function shouldRunFirstTimeSetup(settingsPath: string = getSettingsPath()): boolean {
  if (
    !isOfficialDistribution({
      appName: APP_NAME,
      configDirName: CONFIG_DIR_NAME,
      packageName: PACKAGE_NAME,
    })
  ) {
    return false;
  }
  if (!areExperimentalFeaturesEnabled()) {
    return false;
  }
  if (readEnv(ENV_AGENT_DIR) !== undefined && readEnv(ENV_AGENT_DIR) !== "") {
    return false;
  }
  return !existsSync(settingsPath);
}

const distribution = { shouldRunFirstTimeSetup };

export default distribution;
