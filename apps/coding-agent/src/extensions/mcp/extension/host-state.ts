import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import mcpServers from "../../../core/mcp-servers.ts";
import type modelRegistryTypes from "../../../core/model-registry.types.ts";
import openBrowserModule from "../../../utils/open-browser.ts";
import configModule from "../config.ts";
import type configTypes from "../config.types.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import type extensionTypes from "../extension.types.ts";
import type oauthTypesNs from "../oauth.types.ts";
import type runtimeTypes from "../runtime.types.ts";

const DEFAULT_STARTUP_WAIT_MS = 10_000;
const { openBrowser } = openBrowserModule;
const { updateMcpServerConfig } = configModule;
const { mcpNamespace } = mcpServers;
function abortedController(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}

export default class McpExtensionState {
  readonly msa: extensionsTypesTypes.ExtensionAPI;

  readonly options: extensionTypes.McpExtensionOptions;

  servers: extensionInternalTypes.McpServer[] = [];

  configuredEntries: configTypes.McpServerEntry[] = [];

  configErrors: string[] = [];

  projectConfig: string | undefined;

  overridden: string[] = [];

  autoEnableCodemode = true;

  warnedUnreachable = false;

  pending: Promise<unknown> | undefined;

  waitedForStartup = false;

  readonly startupWaitMs: number;

  sessionCwd = process.cwd();

  credentials: oauthTypesNs.McpOAuthCredentialStore | undefined;

  warnSignInStorage: (notice: string) => void = () => {};

  modelRegistry: modelRegistryTypes.ModelRegistry | undefined;

  serverLog: runtimeTypes.McpServerLog | undefined;

  readonly openUrl: (url: string) => void;

  readonly updateConfig: NonNullable<extensionTypes.McpExtensionOptions["updateConfig"]>;

  session = abortedController();

  readonly backgroundActions = new Set<Promise<void>>();

  readonly track = <T>(work: Promise<T>): Promise<T> => {
    const task = work.then(
      () => undefined,
      () => undefined,
    );
    this.backgroundActions.add(task);
    void task.finally(() => this.backgroundActions.delete(task));
    return work;
  };

  readonly listeners = new Set<() => void>();

  readonly emitChange = () => {
    for (const listener of this.listeners) listener();
  };

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly openConnections = () =>
    this.servers.flatMap((server) => (server.connection === undefined ? [] : [server.connection]));

  readonly findServer = (name: string) => this.servers.find((server) => server.entry.name === name);

  readonly registeredServers = (): {
    servers: extensionInternalTypes.McpServer[];
    overridden: string[];
  } => {
    const registered: extensionInternalTypes.McpServer[] = [];
    const overriddenNames: string[] = [];
    for (const { name, config, extensionPath } of this.msa.getMcpServers()) {
      const configured = this.configuredEntries.find(
        (entry) => mcpNamespace(entry.name) === mcpNamespace(name),
      );
      if (configured !== undefined) {
        overriddenNames.push(
          `"${name}" registered by ${extensionPath} is overridden by "${configured.name}" in ${configured.source}`,
        );
        continue;
      }
      registered.push({
        entry: { config, name, scope: "extension", source: extensionPath },
        registeredConfig: JSON.stringify(config),
      });
    }
    return { overridden: overriddenNames, servers: registered };
  };

  constructor(msa: extensionsTypesTypes.ExtensionAPI, options: extensionTypes.McpExtensionOptions) {
    this.msa = msa;
    this.options = options;
    this.startupWaitMs = options.startupWaitMs ?? DEFAULT_STARTUP_WAIT_MS;
    this.credentials = options.credentials;
    this.openUrl = options.openUrl ?? openBrowser;
    this.updateConfig =
      options.updateConfig ??
      ((entry, patch) =>
        updateMcpServerConfig(entry.override ?? entry.source, entry.name, patch, {
          override: entry.override !== undefined || entry.scope === "builtin",
        }));
  }
}
