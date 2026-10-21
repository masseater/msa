import platform from "../core/platform/index.ts";
import timings from "../core/timings.ts";
import themeSchema from "../modes/interactive/theme/theme-schema.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import cliInput from "./cli-input.ts";

const { resetTimings } = timings;
const { readEnv, writeEnv } = platform;
const { validateThemeJson } = themeSchema;
const { setThemeJsonValidator } = themeModule;
const { isTruthyEnvFlag } = cliInput;

function prepareEnvironment(args: readonly string[]): boolean {
  resetTimings();
  setThemeJsonValidator(validateThemeJson);
  const offlineMode = args.includes("--offline") || isTruthyEnvFlag(readEnv("MSA_OFFLINE"));
  if (offlineMode) {
    writeEnv("MSA_OFFLINE", "1");
    writeEnv("MSA_SKIP_VERSION_CHECK", "1");
  }
  return offlineMode;
}

const environment = { prepareEnvironment };

export default environment;
