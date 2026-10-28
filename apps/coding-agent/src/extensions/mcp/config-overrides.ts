import mcpServers from "../../core/mcp-servers.ts";
import type configTypes from "./config.types.ts";

const { validateMcpServerConfig } = mcpServers;

const OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"];

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

const configOverrides = { applyOverride, isOverride };

export default configOverrides;
