import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type configTypes from "./config.types.ts";
import type oauthTypesNs from "./oauth.types.ts";
import type runtimeTypes from "./runtime.types.ts";

declare namespace extensionTypes {
  type McpTransportFactory = runtimeTypes.McpTransportFactory;

  interface McpExtensionOptions {
    loadConfig?: (ctx: extensionsTypesTypes.ExtensionContext) => configTypes.LoadedMcpConfig;

    createTransport?: runtimeTypes.McpTransportFactory;

    credentials?: oauthTypesNs.McpOAuthCredentialStore;

    logPath?: string;

    openUrl?: (url: string) => void;

    updateConfig?: (
      entry: configTypes.McpServerEntry,
      patch: configTypes.McpServerConfigPatch,
    ) => void;

    startupWaitMs?: number;
  }

  interface McpServerListing {
    entry: configTypes.McpServerEntry;
    connection?: { instructions?: string | undefined } | undefined;
  }
}

export type { extensionTypes as default };
