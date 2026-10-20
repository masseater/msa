import resolveConfigValuePart1 from "./resolve-config-value-part1.ts";

const {
  commandResultCache,
  getMissingConfigValueEnvVarNames,
  parseConfigValueReference,
  resolveConfigValue,
  resolveConfigValueUncached,
} = resolveConfigValuePart1;

function resolveConfigValueOrThrow(
  config: string,
  description: string,
  env?: Record<string, string>,
): string {
  const resolvedValue = resolveConfigValueUncached(config, env);
  if (resolvedValue !== undefined) {
    return resolvedValue;
  }

  const reference = parseConfigValueReference(config);
  if (reference.type === "command") {
    throw new Error(
      `Failed to resolve ${description} from shell command: ${reference.config.slice(1)}`,
    );
  }

  if (reference.type === "template") {
    const missingEnvVars = getMissingConfigValueEnvVarNames(config, env);
    if (missingEnvVars.length === 1) {
      throw new Error(
        `Failed to resolve ${description} from environment variable: ${missingEnvVars[0]}`,
      );
    }
    if (missingEnvVars.length > 1) {
      throw new Error(
        `Failed to resolve ${description} from environment variables: ${missingEnvVars.join(", ")}`,
      );
    }
  }

  throw new Error(`Failed to resolve ${description}`);
}

function resolveHeaders(
  headers: Record<string, string> | undefined,
  env?: Record<string, string>,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const resolvedValue = resolveConfigValue(value, env);
    if (resolvedValue !== undefined && resolvedValue !== "") {
      resolved[key] = resolvedValue;
    }
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function resolveHeadersOrThrow(
  headers: Record<string, string> | undefined,
  description: string,
  env?: Record<string, string>,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    resolved[key] = resolveConfigValueOrThrow(value, `${description} header "${key}"`, env);
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function clearConfigValueCache(): void {
  commandResultCache.clear();
}

const resolveConfigValuePart2 = {
  clearConfigValueCache,
  resolveConfigValueOrThrow,
  resolveHeaders,
  resolveHeadersOrThrow,
};

export default resolveConfigValuePart2;
