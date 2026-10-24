import { dual } from "effect/Function";

import configModule from "../../config.ts";
import mcpServers from "../../core/mcp-servers.ts";
import type mcpServersTypes from "../../core/mcp-servers.types.ts";
import platformModule from "../../core/platform/index.ts";
import errorsModule from "../../utils/errors.ts";
import configOverrides from "./config-overrides.ts";
import type configTypes from "./config.types.ts";
import credentialHelperConfig from "./credentials/credential-helper-config.ts";

const { mcpNamespace, validateMcpServerConfig } = mcpServers;
const { credentialHelperError } = credentialHelperConfig;
const { applyOverride, applyToBuiltin, isOverride } = configOverrides;
const { toErrorMessage } = errorsModule;
const { dirname, join } = platformModule;
const { exists, makeDirectory, readText, writeFile } = platformModule.files;
const { CONFIG_DIR_NAME } = configModule;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface McpConfigState {
  servers: Map<string, configTypes.McpServerEntry>;
  autoEnableCodemode?: boolean;
  errors: string[];
}

function readConfigFile(
  path: string,
  scope: "global" | "project",
  state: McpConfigState,
): Promise<void> {
  return exists(path).then((found) =>
    found
      ? readText(path).then(
          (content) => applyConfigText({ content, path, scope, state }),
          (error: unknown) => {
            state.errors.push(`${path}: ${toErrorMessage(error)}`);
          },
        )
      : undefined,
  );
}

function applyConfigText(input: {
  readonly content: string;
  readonly path: string;
  readonly scope: "global" | "project";
  readonly state: McpConfigState;
}): void {
  const { content, path, scope, state } = input;
  const { errors } = state;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
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
  const helperError = credentialHelperError(parsed["credentialHelper"], scope);
  if (helperError !== undefined) errors.push(`${path}: ${helperError}`);
  applyServers({ path, scope, servers: parsed["mcpServers"] ?? {}, state });
}

function applyServers(input: {
  readonly path: string;
  readonly scope: "global" | "project";
  readonly servers: object;
  readonly state: McpConfigState;
}): void {
  const { path, scope, state } = input;
  const { servers, errors } = state;
  for (const [name, value] of Object.entries(input.servers)) {
    const base = servers.get(name);
    if (base?.scope === "builtin") {
      const error = applyToBuiltin({ base, name, path, scope, servers, value });
      if (error !== undefined) errors.push(error);
      continue;
    }
    if (scope === "project" && isRecord(value) && isOverride(value)) {
      applyOverride(value, base, errors, path, name, servers);
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

function loadMcpConfig(options: {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
  builtins?: readonly configTypes.McpServerEntry[];
}): Promise<configTypes.LoadedMcpConfig> {
  const state: McpConfigState = {
    errors: [],
    servers: new Map((options.builtins ?? []).map((entry) => [entry.name, entry])),
  };
  const projectConfig = options.projectTrusted
    ? join(options.cwd, CONFIG_DIR_NAME, "mcp.json")
    : undefined;
  return readConfigFile(join(options.agentDir, "mcp.json"), "global", state)
    .then(() =>
      projectConfig !== undefined && projectConfig !== ""
        ? readConfigFile(projectConfig, "project", state)
        : undefined,
    )
    .then(() => loadedConfig(state, projectConfig));
}

function loadedConfig(
  state: McpConfigState,
  projectConfig: string | undefined,
): configTypes.LoadedMcpConfig {
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
): Promise<void> {
  return editMcpServers(path, (servers, parsed) => {
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
  ): Promise<void>;
  (
    name: string,
    patch: configTypes.McpServerConfigPatch,
    options?: { override?: boolean },
  ): (path: string) => Promise<void>;
} = dual((args: IArguments) => args.length >= 3, updateMcpServerConfigImpl);

function addMcpServerConfigImpl(
  path: string,
  name: string,
  config: mcpServersTypes.McpServerConfig,
): Promise<boolean> {
  let replaced = false;
  return editMcpServers(path, (servers, parsed) => {
    const target = servers ?? {};
    replaced = target[name] !== undefined;
    target[name] = config;
    parsed["mcpServers"] = target;
    return true;
  }).then(() => replaced);
}

const addMcpServerConfig: {
  (path: string, name: string, config: mcpServersTypes.McpServerConfig): Promise<boolean>;
  (name: string, config: mcpServersTypes.McpServerConfig): (path: string) => Promise<boolean>;
} = dual((args: IArguments) => args.length >= 3, addMcpServerConfigImpl);

function removeMcpServerConfigImpl(path: string, name: string): Promise<boolean> {
  let removed = false;
  return exists(path).then((found) =>
    found
      ? editMcpServers(path, (servers) => {
          if (servers === undefined || servers[name] === undefined) return false;
          delete servers[name];
          removed = true;
          return true;
        }).then(() => removed)
      : false,
  );
}

const removeMcpServerConfig: {
  (path: string, name: string): Promise<boolean>;
  (name: string): (path: string) => Promise<boolean>;
} = dual((args: IArguments) => args.length >= 2, removeMcpServerConfigImpl);

function editMcpServers(
  path: string,
  edit: (servers: Record<string, unknown> | undefined, parsed: Record<string, unknown>) => boolean,
): Promise<void> {
  return exists(path)
    .then((found) => (found ? readText(path) : undefined))
    .then((content) => writeEdited({ content, edit, path }));
}

function writeEdited(input: {
  readonly content: string | undefined;
  readonly path: string;
  readonly edit: (
    servers: Record<string, unknown> | undefined,
    parsed: Record<string, unknown>,
  ) => boolean;
}): Promise<void> {
  const { content: text, edit, path } = input;
  const parsed: unknown = text === undefined ? {} : JSON.parse(text);
  if (
    !isRecord(parsed) ||
    (parsed["mcpServers"] !== undefined && !isRecord(parsed["mcpServers"]))
  ) {
    throw new Error(`${path}: expected an object with an "mcpServers" object`);
  }
  const servers = isRecord(parsed["mcpServers"]) ? parsed["mcpServers"] : undefined;
  if (!edit(servers, parsed)) return Promise.resolve();
  const indent = (text && /^([ \t]+)\S/mu.exec(text)?.[1]) || "  ";
  return makeDirectory({ path: dirname(path) }).then(() =>
    writeFile({ data: `${JSON.stringify(parsed, null, indent)}\n`, path }),
  );
}

const config = {
  addMcpServerConfig,
  getMcpToolExposure: mcpServers.getMcpToolExposure,
  loadMcpConfig,
  removeMcpServerConfig,
  updateMcpServerConfig,
};

export default config;
