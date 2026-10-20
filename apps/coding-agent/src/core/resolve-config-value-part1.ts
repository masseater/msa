import shellModule from "../utils/shell.ts";
import nodeChildProcess from "./platform/node/child-process.ts";
import processEnv from "./process-env.ts";
import type resolveConfigValueInternalTypes from "./resolve-config-value-internal.types.ts";

const { readEnv } = processEnv;
const { execSync, spawnSync } = nodeChildProcess;

const commandResultCache = new Map<string, string | undefined>();

const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const ENV_VAR_NAME_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*/u;

function appendLiteral(parts: resolveConfigValueInternalTypes.TemplatePart[], value: string): void {
  if (value === "") return;
  const previousPart = parts[parts.length - 1];
  if (previousPart?.type === "literal") {
    previousPart.value += value;
    return;
  }
  parts.push({ type: "literal", value });
}

function parseConfigValueTemplate(config: string): resolveConfigValueInternalTypes.TemplatePart[] {
  const parts: resolveConfigValueInternalTypes.TemplatePart[] = [];
  let index = 0;

  while (index < config.length) {
    const dollarIndex = config.indexOf("$", index);
    if (dollarIndex < 0) {
      appendLiteral(parts, config.slice(index));
      break;
    }

    appendLiteral(parts, config.slice(index, dollarIndex));
    const nextChar = config[dollarIndex + 1];

    if (nextChar === "$" || nextChar === "!") {
      appendLiteral(parts, nextChar);
      index = dollarIndex + 2;
      continue;
    }

    if (nextChar === "{") {
      const endIndex = config.indexOf("}", dollarIndex + 2);
      if (endIndex < 0) {
        appendLiteral(parts, "$");
        index = dollarIndex + 1;
        continue;
      }

      parseConfigValueTemplatePart1(config, dollarIndex, endIndex, parts);
      index = endIndex + 1;
      continue;
    }

    const match = config.slice(dollarIndex + 1).match(ENV_VAR_NAME_PREFIX_RE);
    if (match !== null) {
      parts.push({ name: match[0], type: "env" });
      index = dollarIndex + 1 + match[0].length;
      continue;
    }

    appendLiteral(parts, "$");
    index = dollarIndex + 1;
  }

  return parts;
}

function parseConfigValueTemplatePart1(
  config: string,
  dollarIndex: number,
  endIndex: number,
  parts: resolveConfigValueInternalTypes.TemplatePart[],
) {
  const name = config.slice(dollarIndex + 2, endIndex);
  if (ENV_VAR_NAME_RE.test(name)) {
    parts.push({ name, type: "env" });
  } else {
    appendLiteral(parts, config.slice(dollarIndex, endIndex + 1));
  }
}

function parseConfigValueReference(
  config: string,
): resolveConfigValueInternalTypes.ConfigValueReference {
  if (config.startsWith("!")) {
    return { config, type: "command" };
  }

  return { parts: parseConfigValueTemplate(config), type: "template" };
}

function resolveEnvConfigValue(name: string, env?: Record<string, string>): string | undefined {
  return env?.[name] || readEnv(name) || undefined;
}

function getTemplateEnvVarNames(parts: resolveConfigValueInternalTypes.TemplatePart[]): string[] {
  const names: string[] = [];
  for (const part of parts) {
    if (part.type !== "env" || names.includes(part.name)) continue;
    names.push(part.name);
  }
  return names;
}

function resolveTemplate(
  parts: resolveConfigValueInternalTypes.TemplatePart[],
  env?: Record<string, string>,
): string | undefined {
  let resolved = "";
  for (const part of parts) {
    if (part.type === "literal") {
      resolved += part.value;
      continue;
    }
    const envValue = resolveEnvConfigValue(part.name, env);
    if (envValue === undefined) return undefined;
    resolved += envValue;
  }
  return resolved;
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

function isConfigValueConfigured(config: string, env?: Record<string, string>): boolean {
  return getMissingConfigValueEnvVarNames(config, env).length === 0;
}

function resolveConfigValue(config: string, env?: Record<string, string>): string | undefined {
  const reference = parseConfigValueReference(config);
  if (reference.type === "command") {
    return executeCommand(reference.config);
  }
  return resolveTemplate(reference.parts, env);
}

function executeWithConfiguredShell(command: string): {
  executed: boolean;
  value: string | undefined;
} {
  try {
    const { shell, args, commandTransport } = shellModule.getShellConfig();
    const commandFromStdin = commandTransport === "stdin";
    const result = spawnSync(shell, commandFromStdin ? args : [...args, command], {
      encoding: "utf-8",
      input: commandFromStdin ? command : undefined,
      shell: false,
      stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "ignore"],
      timeout: 10000,
      windowsHide: true,
    });

    if (result.error !== undefined) {
      const error = result.error as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return { executed: false, value: undefined };
      }
      return { executed: true, value: undefined };
    }

    if (result.status !== 0) {
      return { executed: true, value: undefined };
    }

    const value = (result.stdout ?? "").trim();
    return { executed: true, value: value || undefined };
  } catch {
    return { executed: false, value: undefined };
  }
}

function executeWithDefaultShell(command: string): string | undefined {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

function executeCommandUncached(commandConfig: string): string | undefined {
  const command = commandConfig.slice(1);
  return process.platform === "win32"
    ? (() => {
        const configuredResult = executeWithConfiguredShell(command);
        return configuredResult.executed
          ? configuredResult.value
          : executeWithDefaultShell(command);
      })()
    : executeWithDefaultShell(command);
}

function executeCommand(commandConfig: string): string | undefined {
  if (commandResultCache.has(commandConfig)) {
    return commandResultCache.get(commandConfig);
  }

  const result = executeCommandUncached(commandConfig);
  commandResultCache.set(commandConfig, result);
  return result;
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

const resolveConfigValuePart1 = {
  commandResultCache,
  getConfigValueEnvVarName,
  getConfigValueEnvVarNames,
  getMissingConfigValueEnvVarNames,
  isCommandConfigValue,
  isConfigValueConfigured,
  parseConfigValueReference,
  resolveConfigValue,
  resolveConfigValueUncached,
};

export default resolveConfigValuePart1;
