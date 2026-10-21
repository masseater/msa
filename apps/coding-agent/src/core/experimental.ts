import platform from "./platform/index.ts";

const { readEnv } = platform;

function areExperimentalFeaturesEnabled(): boolean {
  return readEnv("MSA_EXPERIMENTAL") === "1";
}

const experimental = {
  areExperimentalFeaturesEnabled,
};

export default experimental;
