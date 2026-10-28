import configValueCommand from "./config-value-command.ts";
import configValueTemplate from "./config-value-template.ts";

const {
  resolveEnvConfigValue,
  getTemplateEnvVarNames,
  resolveTemplate,
  parseConfigValueReference,
} = configValueTemplate;
const { commandResultCache, executeCommandUncached, executeCommand } = configValueCommand;

function resolveConfigValue(config: string, env?: Record<string, string>): string | undefined {
  const reference = parseConfigValueReference(config);
  if (reference.type === "command") {
    return executeCommand(reference.config);
  }
  return resolveTemplate(reference.parts, env);
}

function resolveConfigValueUncached(
  config: string,
  env?: Record<string, string>,
): string | undefined {
  const reference = parseConfigValueReference(config);
  if (reference.type === "command") {
    return executeCommandUncached(reference.config);
  }
  return resolveTemplate(reference.parts, env);
}

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
  const resolved = Object.entries(headers).flatMap(([key, value]) => {
    const resolvedValue = resolveConfigValue(value, env);
    return resolvedValue === undefined || resolvedValue === ""
      ? []
      : [[key, resolvedValue] as const];
  });
  return resolved.length > 0 ? Object.fromEntries(resolved) : undefined;
}

function resolveHeadersOrThrow(
  headers: Record<string, string> | undefined,
  description: string,
  env?: Record<string, string>,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  const resolved = Object.entries(headers).map(
    ([key, value]) =>
      [key, resolveConfigValueOrThrow(value, `${description} header "${key}"`, env)] as const,
  );
  return resolved.length > 0 ? Object.fromEntries(resolved) : undefined;
}

function clearConfigValueCache(): void {
  commandResultCache.clear();
}

function isConfigValueConfigured(config: string, env?: Record<string, string>): boolean {
  return getMissingConfigValueEnvVarNames(config, env).length === 0;
}

function getConfigValueEnvVarName(config: string): string | undefined {
  const reference = parseConfigValueReference(config);
  if (reference.type !== "template") return undefined;
  return reference.parts.length === 1 && reference.parts[0]?.type === "env"
    ? reference.parts[0].name
    : undefined;
}

function getConfigValueEnvVarNames(config: string): string[] {
  const reference = parseConfigValueReference(config);
  return reference.type === "template" ? getTemplateEnvVarNames(reference.parts) : [];
}

function getMissingConfigValueEnvVarNames(config: string, env?: Record<string, string>): string[] {
  return getConfigValueEnvVarNames(config).filter(
    (name) => resolveEnvConfigValue(name, env) === undefined,
  );
}

function isCommandConfigValue(config: string): boolean {
  return parseConfigValueReference(config).type === "command";
}

const resolveConfigValueModule = {
  clearConfigValueCache,
  getConfigValueEnvVarName,
  getConfigValueEnvVarNames,
  isCommandConfigValue,
  isConfigValueConfigured,
  resolveConfigValue,
  resolveConfigValueOrThrow,
  resolveConfigValueUncached,
  resolveHeaders,
  resolveHeadersOrThrow,
};

export default resolveConfigValueModule;
