export function areExperimentalFeaturesEnabled(): boolean {
  return process.env.MSA_EXPERIMENTAL === "1";
}
