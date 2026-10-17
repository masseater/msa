import { Effect } from "effect";

import type { AuthProvider, UnauthorizedContext } from "../auth-provider.ts";
import { fromPromise, type McpForeignError, toPromise } from "../foreign.ts";
import { parseWwwAuthenticate } from "./discovery.ts";
import { McpOAuthAuthorizationRequiredError } from "./errors.ts";
import type { OAuthClientProvider } from "./flow-types.ts";
import { authorizeMcp, stepUpScope } from "./flow.ts";

const accessToken = (
  provider: OAuthClientProvider,
): Effect.Effect<string | undefined, McpForeignError> =>
  fromPromise(() => provider.tokens()).pipe(Effect.map((tokens) => tokens?.access_token));

export function adaptOAuthProvider(provider: OAuthClientProvider): AuthProvider {
  let inFlight: Promise<void> | undefined;
  const recover = (context: UnauthorizedContext, insufficientScope: boolean) =>
    Effect.gen(function* () {
      const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
      const granted = insufficientScope ? yield* fromPromise(() => provider.tokens()) : undefined;
      const result = yield* authorizeMcp(provider, {
        serverUrl: context.serverUrl,
        resourceMetadataUrl: challenge.resourceMetadataUrl,
        scope: insufficientScope ? stepUpScope(granted?.scope, challenge.scope) : challenge.scope,
        fetch: context.fetch,
        skipRefresh: insufficientScope,
      });
      if (result === "REDIRECT") return yield* new McpOAuthAuthorizationRequiredError();
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          inFlight = undefined;
        }),
      ),
    );
  return {
    token: () => toPromise(accessToken(provider)),
    onUnauthorized: (context: UnauthorizedContext) =>
      toPromise(
        Effect.gen(function* () {
          const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
          const insufficientScope = challenge.error === "insufficient_scope";
          if (!insufficientScope && inFlight === undefined && context.token !== undefined) {
            const current = yield* accessToken(provider);
            if (current !== undefined && current !== context.token) return;
          }
          inFlight ??= toPromise(recover(context, insufficientScope));
          const shared = inFlight;
          yield* fromPromise(() => shared);
        }),
      ),
  };
}
