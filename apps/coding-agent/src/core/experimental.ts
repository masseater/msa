import { readEnv } from "./process-env.ts";

export function areExperimentalFeaturesEnabled(): boolean {
  return readEnv("MSA_EXPERIMENTAL") === "1";
}
