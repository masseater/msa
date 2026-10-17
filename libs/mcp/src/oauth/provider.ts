import { Clock, Effect } from "effect";

import { fromPromise, type McpForeignError, toPromise } from "../foreign.ts";
import { present } from "./endpoint.ts";
import { OAuthFlowError } from "./errors.ts";
import type { OAuthClientMetadataDocument, OAuthClientProvider } from "./flow-types.ts";
import { MemoryOAuthStateStore } from "./memory-store.ts";
import type {
  McpOAuthProviderOptions,
  McpOAuthState,
  McpOAuthStateStore,
} from "./provider-types.ts";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthDiscoveryState,
  OAuthTokens,
} from "./types.ts";

export { MemoryOAuthStateStore } from "./memory-store.ts";
export type {
  McpOAuthProviderOptions,
  McpOAuthState,
  McpOAuthStateStore,
} from "./provider-types.ts";

type CredentialKind = "all" | "client" | "tokens" | "verifier" | "discovery";

function invalidated(value: McpOAuthState, kind: CredentialKind): McpOAuthState {
  const next = { ...value };
  if (kind === "all" || kind === "client") delete next.clientInformation;
  if (kind === "all" || kind === "tokens") {
    delete next.tokens;
    delete next.tokensExpireAt;
  }
  if (kind === "all" || kind === "verifier") delete next.codeVerifier;
  if (kind === "all" || kind === "discovery") delete next.discovery;
  if (kind === "all") delete next.oauthState;
  return next;
}

export class McpOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;
  readonly clientMetadataDocument?: (
    metadata: AuthorizationServerMetadata | undefined,
  ) => OAuthClientMetadataDocument | undefined;
  private serverUrl: string;
  private configuredClient: OAuthClientInformationMixed | undefined;
  private store: McpOAuthStateStore;
  private onRedirect: (url: URL) => void | Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(options: McpOAuthProviderOptions) {
    this.serverUrl = String(new URL(options.serverUrl));
    this.redirectUrl = String(options.redirectUrl);
    const hasSecret = present(options.clientSecret);
    this.clientMetadata = {
      ...options.clientMetadata,
      redirect_uris: options.clientMetadata.redirect_uris ?? [this.redirectUrl],
      grant_types: options.clientMetadata.grant_types ?? ["authorization_code", "refresh_token"],
      response_types: options.clientMetadata.response_types ?? ["code"],
      token_endpoint_auth_method:
        options.clientMetadata.token_endpoint_auth_method ??
        (hasSecret ? "client_secret_post" : "none"),
    };
    if (options.clientMetadataDocument !== undefined)
      this.clientMetadataDocument = options.clientMetadataDocument;
    this.configuredClient = present(options.clientId)
      ? {
          client_id: options.clientId,
          ...(hasSecret ? { client_secret: options.clientSecret } : {}),
        }
      : undefined;
    this.store = options.store ?? new MemoryOAuthStateStore();
    this.onRedirect = options.onRedirect;
  }

  state(): Promise<string> {
    return toPromise(
      Effect.gen({ self: this }, function* () {
        const existing = (yield* this.load()).oauthState;
        if (present(existing)) return existing;
        const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
        yield* this.update((value) => ({ ...value, oauthState: state }));
        return state;
      }),
    );
  }

  clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const configured = this.configuredClient;
    if (configured !== undefined) return Promise.resolve(configured);
    return toPromise(this.load().pipe(Effect.map((value) => value.clientInformation)));
  }

  saveClientInformation(information: OAuthClientInformationMixed): Promise<void> {
    if (this.configuredClient !== undefined) return Promise.resolve();
    return toPromise(this.update((value) => ({ ...value, clientInformation: information })));
  }

  tokens(): Promise<OAuthTokens | undefined> {
    return toPromise(this.load().pipe(Effect.map((value) => value.tokens)));
  }

  saveTokens(tokens: OAuthTokens): Promise<void> {
    return toPromise(
      Effect.gen({ self: this }, function* () {
        const now = yield* Clock.currentTimeMillis;
        const expiresAt =
          tokens.expires_in === undefined ? undefined : now + tokens.expires_in * 1000;
        yield* this.update((value) => {
          const next: McpOAuthState = { ...value, tokens };
          if (expiresAt === undefined) delete next.tokensExpireAt;
          else next.tokensExpireAt = expiresAt;
          return next;
        });
      }),
    );
  }

  redirectToAuthorization(url: URL): Promise<void> {
    return toPromise(fromPromise(() => this.onRedirect(url)));
  }

  saveCodeVerifier(verifier: string): Promise<void> {
    return toPromise(this.update((value) => ({ ...value, codeVerifier: verifier })));
  }

  codeVerifier(): Promise<string> {
    return toPromise(
      Effect.gen({ self: this }, function* () {
        const verifier = (yield* this.load()).codeVerifier;
        if (!present(verifier))
          return yield* new OAuthFlowError("No OAuth PKCE code verifier is stored");
        return verifier;
      }),
    );
  }

  invalidateCredentials(kind: CredentialKind): Promise<void> {
    return toPromise(this.update((value) => invalidated(value, kind)));
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
    return toPromise(this.update((value) => ({ ...value, discovery })));
  }

  discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return toPromise(this.load().pipe(Effect.map((value) => value.discovery)));
  }

  private load(): Effect.Effect<McpOAuthState, McpForeignError> {
    return Effect.gen({ self: this }, function* () {
      const writes = this.writes;
      yield* fromPromise(() => writes);
      const store = this.store;
      return this.own(yield* fromPromise(() => store.load()));
    });
  }

  private update(
    update: (state: McpOAuthState) => McpOAuthState,
  ): Effect.Effect<void, McpForeignError> {
    return Effect.suspend(() => {
      const store = this.store;
      const write = Effect.gen({ self: this }, function* () {
        const current = yield* fromPromise(() => store.load());
        const next = update(this.own(current));
        yield* fromPromise(() => store.save(next));
      });
      this.writes = this.writes.then(() => toPromise(write));
      const writes = this.writes;
      return fromPromise(() => writes);
    });
  }

  private own(state: McpOAuthState | undefined): McpOAuthState {
    return state?.serverUrl === this.serverUrl ? state : { serverUrl: this.serverUrl };
  }
}
