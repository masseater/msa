import { readEnv } from "./platform.ts";
export function areExperimentalFeaturesEnabled(): boolean {
  return readEnv("MSA_EXPERIMENTAL") === "1";
}
