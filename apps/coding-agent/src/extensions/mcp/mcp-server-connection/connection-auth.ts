import type oauthTypes from "@msa/mcp/oauth.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import resolveConfigValueModule from "../../../core/resolve-config-value.ts";
import mcpServerConnectionHelpers from "../mcp-server-connection-helpers.ts";
import type McpServerConnection from "../mcp-server-connection.ts";
import oauthModuleModule from "../oauth.ts";
import type oauthTypesNs from "../oauth.types.ts";

const { resolveConfigValueOrThrow } = resolveConfigValueModule;
const { awaited, awaiting } = awaitingModule;
const { usesOAuth } = mcpServerConnectionHelpers;
const { createMcpAuthProvider } = oauthModuleModule;

export default class McpConnectionAuth {
  private readonly connection: McpServerConnection;

  authProvider: oauthTypesNs.McpAuthProvider | undefined;

  challenge: oauthTypes.OAuthChallenge | undefined;

  constructor(connection: McpServerConnection) {
    this.connection = connection;
  }

  get oauthUrl(): string | undefined {
    return usesOAuth(this.connection.entry) && "url" in this.connection.entry.config
      ? this.connection.entry.config.url
      : undefined;
  }

  oauthSettings(): oauthTypesNs.McpOAuthSettings {
    const oauth =
      "url" in this.connection.entry.config ? this.connection.entry.config.oauth : undefined;
    if (oauth === undefined) return {};
    return {
      authServerMetadataUrl:
        oauth.authServerMetadataUrl !== undefined && oauth.authServerMetadataUrl !== ""
          ? new URL(oauth.authServerMetadataUrl)
          : undefined,
      callbackPort: oauth.callbackPort,
      callbackUrl: oauth.callbackUrl,
      clientId: oauth.clientId,
      clientName: oauth.clientName,
      clientRegistration: oauth.clientRegistration,
      clientSecret:
        oauth.clientSecret === undefined
          ? undefined
          : resolveConfigValueOrThrow(
              oauth.clientSecret,
              `MCP server "${this.connection.entry.name}" oauth.clientSecret`,
            ),
      scope: oauth.scope,
    };
  }

  configure(
    credentials: oauthTypesNs.McpOAuthCredentialStore,
    providerToken: ((provider: string) => Promise<string | undefined>) | undefined,
  ): void {
    const url = this.oauthUrl;
    const provider =
      "url" in this.connection.entry.config
        ? this.connection.entry.config.auth?.provider
        : undefined;
    this.authProvider =
      url !== undefined && url !== ""
        ? createMcpAuthProvider({
            onChallenge: (challenge) => {
              this.challenge = challenge;
            },
            serverUrl: url,
            settings: () => this.oauthSettings(),
            store: credentials.forServer(this.connection.entry.name, url),
          })
        : provider !== undefined && provider !== ""
          ? {
              settled: () => Effect.runPromise(Effect.sync(() => {})),
              token: () =>
                Effect.runPromise(
                  awaiting(function* () {
                    return yield* awaited(providerToken?.(provider));
                  }),
                ),
            }
          : undefined;
  }
}
