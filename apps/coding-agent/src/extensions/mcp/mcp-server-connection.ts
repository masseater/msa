import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type configTypes from "./config.types.ts";
import type connectionTypes from "./connection.types.ts";
import type logTypes from "./log.types.ts";
import McpServerConnectionLayer2 from "./mcp-server-connection-layer-2.ts";
import oauthModuleModule from "./oauth.ts";
import type oauthTypesNs from "./oauth.types.ts";
import type resourcesTypes from "./resources.types.ts";
import type toolsTypes from "./tools.types.ts";

const { createMcpAuthProvider } = oauthModuleModule;
const { awaited, awaiting } = awaitingModule;

export default class McpServerConnection
  extends McpServerConnectionLayer2
  implements toolsTypes.McpToolCaller, resourcesTypes.McpResourceServer
{
  constructor(options: {
    entry: configTypes.McpServerEntry;
    cwd: string;
    createTransport: connectionTypes.McpTransportFactory;
    credentials: oauthTypesNs.McpOAuthCredentialStore;

    providerToken?: (provider: string) => Promise<string | undefined>;
    onTools: (connection: McpServerConnection) => void;

    onChange?: (connection: McpServerConnection) => void;

    log?: logTypes.McpServerLog;
  }) {
    super();
    this.entry = options.entry;
    this.cwd = options.cwd;
    this.createTransport = options.createTransport;
    this.onTools = options.onTools;
    this.onChange = options.onChange;
    this.log = options.log;
    const url = this.oauthUrl;
    const provider = "url" in this.entry.config ? this.entry.config.auth?.provider : undefined;
    this.authProvider =
      url !== undefined && url !== ""
        ? createMcpAuthProvider({
            onChallenge: (challenge) => {
              this.challenge = challenge;
            },
            serverUrl: url,
            settings: () => this.oauthSettings(),
            store: options.credentials.forServer(this.entry.name, url),
          })
        : provider !== undefined && provider !== ""
          ? {
              settled: () => Effect.runPromise(Effect.sync(() => {})),
              token: () =>
                Effect.runPromise(
                  awaiting(function* () {
                    return yield* awaited(options.providerToken?.(provider));
                  }),
                ),
            }
          : undefined;
  }
}
