import { dual } from "effect/Function";

import configModule from "../../config.ts";
import mcpServers from "../../core/mcp-servers.ts";
import type mcpServersTypes from "../../core/mcp-servers.types.ts";
import platformNode from "../../core/platform-node.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import errorsModule from "../../utils/errors.ts";
import type configTypes from "./config.types.ts";

const { existsSync, mkdirSync, readFileSync, writeFileSync } = nodeFs;

const { mcpNamespace, validateMcpServerConfig } = mcpServers;
const { toErrorMessage } = errorsModule;
const { dirname, join } = platformNode;
const { CONFIG_DIR_NAME } = configModule;

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
  servers: Map<string, configTypes.McpServerEntry>;
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
      readConfigFilePart1(value, base, errors, path, name, servers);
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
    servers.set(name, { config, name, scope, source: path });
  }
}

function readConfigFilePart1(
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

function loadMcpConfig(options: {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
}): configTypes.LoadedMcpConfig {
  const state: McpConfigState = { errors: [], servers: new Map() };
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

function updateMcpServerConfigImpl(
  path: string,
  name: string,
  patch: configTypes.McpServerConfigPatch,
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

const updateMcpServerConfig: {
  (
    path: string,
    name: string,
    patch: configTypes.McpServerConfigPatch,
    options?: { override?: boolean },
  ): void;
  (
    name: string,
    patch: configTypes.McpServerConfigPatch,
    options?: { override?: boolean },
  ): (path: string) => void;
} = dual((args: IArguments) => args.length >= 3, updateMcpServerConfigImpl);

function addMcpServerConfigImpl(
  path: string,
  name: string,
  config: mcpServersTypes.McpServerConfig,
): boolean {
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

const addMcpServerConfig: {
  (path: string, name: string, config: mcpServersTypes.McpServerConfig): boolean;
  (name: string, config: mcpServersTypes.McpServerConfig): (path: string) => boolean;
} = dual((args: IArguments) => args.length >= 3, addMcpServerConfigImpl);

function removeMcpServerConfigImpl(path: string, name: string): boolean {
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

const removeMcpServerConfig: {
  (path: string, name: string): boolean;
  (name: string): (path: string) => boolean;
} = dual((args: IArguments) => args.length >= 2, removeMcpServerConfigImpl);

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

const config = {
  addMcpServerConfig,
  getMcpToolExposure: mcpServers.getMcpToolExposure,
  loadMcpConfig,
  removeMcpServerConfig,
  updateMcpServerConfig,
};

export default config;
