import processEnv from "./process-env.ts";

const { readEnv } = processEnv;

function areExperimentalFeaturesEnabled(): boolean {
  return readEnv("MSA_EXPERIMENTAL") === "1";
}

const experimental = {
  areExperimentalFeaturesEnabled,
};

export default experimental;
