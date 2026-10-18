import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { CONFIG_DIR_NAME } from "../../config.ts";
import {
  type McpExposure,
  type McpServerConfig,
  mcpNamespace,
  validateMcpServerConfig,
} from "../../core/mcp-servers.ts";
import { dirname, join } from "../../core/platform-node.ts";
import { toErrorMessage } from "../../utils/errors.ts";

export type {
  McpExposure,
  McpHttpServerConfig,
  McpOAuthConfig,
  McpServerConfig,
  McpStdioServerConfig,
} from "../../core/mcp-servers.ts";
export { getMcpToolExposure } from "../../core/mcp-servers.ts";

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;

  source: string;

  scope?: "global" | "project" | "extension";

  override?: string;
}

export interface LoadedMcpConfig {
  servers: McpServerEntry[];

  autoEnableCodemode?: boolean;
  errors: string[];

  projectConfig?: string;
}

const OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"];

function isOverride(value: Record<string, unknown>): boolean {
  return (
    value["command"] === undefined && value["url"] === undefined && value["type"] === undefined
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface McpConfigState {
  servers: Map<string, McpServerEntry>;
  autoEnableCodemode?: boolean;
  errors: string[];
}

function readConfigFile(path: string, scope: "global" | "project", state: McpConfigState): void {
  const { servers, errors } = state;
  if (!existsSync(path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: ${toErrorMessage(error)}`);
    return;
  }
  if (
    !isRecord(parsed) ||
    (parsed["mcpServers"] !== undefined && !isRecord(parsed["mcpServers"]))
  ) {
    errors.push(`${path}: expected an object with an "mcpServers" object`);
    return;
  }
  if (typeof parsed["autoEnableCodemode"] === "boolean")
    state.autoEnableCodemode = parsed["autoEnableCodemode"];
  else if (parsed["autoEnableCodemode"] !== undefined)
    errors.push(`${path}: autoEnableCodemode must be a boolean`);
  for (const [name, value] of Object.entries(parsed["mcpServers"] ?? {})) {
    if (scope === "project" && isRecord(value) && isOverride(value)) {
      const base = servers.get(name);
      const extra = Object.keys(value).filter((key) => !OVERRIDE_KEYS.includes(key));
      if (base === undefined) {
        errors.push(
          `${path}: server "${name}" needs "command" or "url", or a global server to override`,
        );
      } else if (extra.length > 0) {
        errors.push(
          `${path}: server "${name}": an override can only set ${OVERRIDE_KEYS.join(", ")}`,
        );
      } else {
        const config = validateMcpServerConfig(name, { ...base.config, ...value });
        if (typeof config === "string") errors.push(`${path}: ${config}`);
        else servers.set(name, { ...base, config, override: path });
      }
      continue;
    }
    const config = validateMcpServerConfig(name, value);
    if (typeof config === "string") {
      errors.push(`${path}: ${config}`);
      continue;
    }

    const clash = [...servers.keys()].find(
      (other) => other !== name && mcpNamespace(other) === mcpNamespace(name),
    );
    if (clash !== undefined && clash !== "") {
      errors.push(`${path}: server "${name}" conflicts with "${clash}"`);
      continue;
    }
    if (scope === "project" && "url" in config && config.auth !== undefined) {
      errors.push(`${path}: server "${name}": auth is only allowed in the global mcp.json`);
      continue;
    }
    servers.set(name, { name, config, source: path, scope });
  }
}

export function loadMcpConfig(options: {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
}): LoadedMcpConfig {
  const state: McpConfigState = { servers: new Map(), errors: [] };
  readConfigFile(join(options.agentDir, "mcp.json"), "global", state);
  const projectConfig = options.projectTrusted
    ? join(options.cwd, CONFIG_DIR_NAME, "mcp.json")
    : undefined;
  if (projectConfig !== undefined && projectConfig !== "")
    readConfigFile(projectConfig, "project", state);
  return {
    servers: [...state.servers.values()],
    ...(state.autoEnableCodemode === undefined
      ? {}
      : { autoEnableCodemode: state.autoEnableCodemode }),
    errors: state.errors,
    ...(projectConfig !== undefined && projectConfig !== "" ? { projectConfig } : {}),
  };
}

export interface McpServerConfigPatch {
  enabled?: boolean;
  exposure?: McpExposure;
}

export function updateMcpServerConfig(
  path: string,
  name: string,
  patch: McpServerConfigPatch,
  options: { override?: boolean } = {},
): void {
  editMcpServers(path, (servers, parsed) => {
    let server = servers?.[name];
    if (server === undefined && options.override === true) {
      server = {};
      parsed["mcpServers"] = { ...servers, [name]: server };
    }
    if (!isRecord(server)) throw new Error(`${path} does not define MCP server "${name}"`);
    const keepDefaults = isOverride(server);
    if (patch.enabled !== undefined) {
      if (patch.enabled && !keepDefaults) delete server["enabled"];
      else server["enabled"] = patch.enabled;
    }
    if (patch.exposure !== undefined) {
      if (patch.exposure === "codemode" && !keepDefaults) delete server["exposure"];
      else server["exposure"] = patch.exposure;
    }
    return true;
  });
}

export function addMcpServerConfig(path: string, name: string, config: McpServerConfig): boolean {
  let replaced = false;
  editMcpServers(path, (servers, parsed) => {
    const target = servers ?? {};
    replaced = target[name] !== undefined;
    target[name] = config;
    parsed["mcpServers"] = target;
    return true;
  });
  return replaced;
}

export function removeMcpServerConfig(path: string, name: string): boolean {
  if (!existsSync(path)) return false;
  let removed = false;
  editMcpServers(path, (servers) => {
    if (servers === undefined || servers[name] === undefined) return false;
    delete servers[name];
    removed = true;
    return true;
  });
  return removed;
}

function editMcpServers(
  path: string,
  edit: (servers: Record<string, unknown> | undefined, parsed: Record<string, unknown>) => boolean,
): void {
  const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const parsed: unknown = text === undefined ? {} : JSON.parse(text);
  if (
    !isRecord(parsed) ||
    (parsed["mcpServers"] !== undefined && !isRecord(parsed["mcpServers"]))
  ) {
    throw new Error(`${path}: expected an object with an "mcpServers" object`);
  }
  const servers = isRecord(parsed["mcpServers"]) ? parsed["mcpServers"] : undefined;
  if (!edit(servers, parsed)) return;
  const indent = (text && /^([ \t]+)\S/mu.exec(text)?.[1]) || "  ";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, indent)}\n`);
}
