import config from "../config.ts";

const { getAgentDir } = config;

function getDefaultAgentDir(): string {
  return getAgentDir();
}

const sdkPart1 = {
  getDefaultAgentDir,
};

export default sdkPart1;
