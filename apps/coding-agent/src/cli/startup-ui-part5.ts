import config from "../config.ts";
import experimental from "../core/experimental.ts";
import nodeFs from "../core/platform/node/fs.ts";
import processEnv from "../core/process-env.ts";
import startupUiPart1 from "./startup-ui-part1.ts";

const { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR, PACKAGE_NAME, getSettingsPath } = config;
const { areExperimentalFeaturesEnabled } = experimental;
const { readEnv } = processEnv;
const { existsSync } = nodeFs;
const { isOfficialDistribution } = startupUiPart1;

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

const startupUiPart5 = {
  shouldRunFirstTimeSetup,
};

export default startupUiPart5;
