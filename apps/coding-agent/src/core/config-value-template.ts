import platform from "./platform/index.ts";
import type resolveConfigValueInternalTypes from "./resolve-config-value-internal.types.ts";

const { readEnv } = platform;

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

      appendTemplateReference(config, dollarIndex, endIndex, parts);
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

function appendTemplateReference(
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

const configValueTemplate = {
  getTemplateEnvVarNames,
  parseConfigValueReference,
  resolveEnvConfigValue,
  resolveTemplate,
};

export default configValueTemplate;
