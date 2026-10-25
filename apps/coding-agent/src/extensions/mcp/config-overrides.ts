import mcpServers from "../../core/mcp-servers.ts";
import type configTypes from "./config.types.ts";

const { validateMcpServerConfig } = mcpServers;

const OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isOverride(value: Record<string, unknown>): boolean {
  return (
    value["command"] === undefined && value["url"] === undefined && value["type"] === undefined
  );
}

function applyOverride(
  value: Record<string, unknown>,
  base: configTypes.McpServerEntry | undefined,
  errors: string[],
  path: string,
  name: string,
  servers: Map<string, configTypes.McpServerEntry>,
) {
  const extra = Object.keys(value).filter((key) => !OVERRIDE_KEYS.includes(key));
  if (base === undefined) {
    errors.push(
      `${path}: server "${name}" needs "command" or "url", or a global server to override`,
    );
  } else if (extra.length > 0) {
    errors.push(`${path}: server "${name}": an override can only set ${OVERRIDE_KEYS.join(", ")}`);
  } else {
    const config = validateMcpServerConfig(name, { ...base.config, ...value });
    if (typeof config === "string") errors.push(`${path}: ${config}`);
    else servers.set(name, { ...base, config, override: path });
  }
}

function applyToBuiltin(input: {
  readonly base: configTypes.McpServerEntry;
  readonly name: string;
  readonly path: string;
  readonly scope: "global" | "project";
  readonly servers: Map<string, configTypes.McpServerEntry>;
  readonly value: unknown;
}): string | undefined {
  const { base, name, path, scope, servers, value } = input;
  if (!isRecord(value)) return `${path}: server "${name}" must be an object`;
  const override = isOverride(value);
  if (!override && scope === "project")
    return `${path}: server "${name}" is built in; a project mcp.json can only set enabled`;
  if (override && Object.keys(value).some((key) => key !== "enabled"))
    return `${path}: server "${name}" is built in; an override can only set enabled`;
  const validated = validateMcpServerConfig(name, override ? { ...base.config, ...value } : value);
  if (typeof validated === "string") return `${path}: ${validated}`;
  const config = { ...validated, exposure: "hidden" as const };
  delete config.toolExposure;
  if (base.config.enabled === false && value["enabled"] === undefined) config.enabled = false;
  servers.set(name, { ...base, config, ...(scope === "project" ? { override: path } : {}) });
  return undefined;
}

const configOverrides = { applyOverride, applyToBuiltin, isOverride };

export default configOverrides;
