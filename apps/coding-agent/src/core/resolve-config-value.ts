import resolveConfigValuePart1 from "./resolve-config-value-part1.ts";
import resolveConfigValuePart2 from "./resolve-config-value-part2.ts";

const { clearConfigValueCache, resolveConfigValueOrThrow, resolveHeaders, resolveHeadersOrThrow } =
  resolveConfigValuePart2;
const {
  getConfigValueEnvVarName,
  getConfigValueEnvVarNames,
  getMissingConfigValueEnvVarNames,
  isCommandConfigValue,
  isConfigValueConfigured,
  resolveConfigValue,
  resolveConfigValueUncached,
} = resolveConfigValuePart1;

const resolveConfigValueModule = {
  clearConfigValueCache,
  getConfigValueEnvVarName,
  getConfigValueEnvVarNames,
  getMissingConfigValueEnvVarNames,
  isCommandConfigValue,
  isConfigValueConfigured,
  resolveConfigValue,
  resolveConfigValueOrThrow,
  resolveConfigValueUncached,
  resolveHeaders,
  resolveHeadersOrThrow,
};

export default resolveConfigValueModule;
