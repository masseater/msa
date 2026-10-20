import { Effect } from "effect";

import type authProviderTypes from "../auth-provider.ts";
import foreignModule from "../foreign.ts";
import type foreignTypes from "../foreign.types.ts";
import discovery from "./discovery.ts";
import errors from "./errors.ts";
import type flowTypesModule from "./flow-types.ts";
import flow from "./flow.ts";

const { fromPromise, toPromise } = foreignModule;
const { parseWwwAuthenticate } = discovery;
const { authorizeMcp, stepUpScope } = flow;
const { McpOAuthAuthorizationRequiredError } = errors;

const accessToken = (
  provider: flowTypesModule.OAuthClientProvider,
): Effect.Effect<string | undefined, foreignTypes.McpForeignError> =>
  fromPromise(() => provider.tokens()).pipe(Effect.map((tokens) => tokens?.access_token));

function adaptOAuthProvider(
  provider: flowTypesModule.OAuthClientProvider,
): authProviderTypes.AuthProvider {
  let inFlight: Promise<void> | undefined;
  const recover = (context: authProviderTypes.UnauthorizedContext, insufficientScope: boolean) =>
    Effect.gen(function* () {
      const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
      const granted = insufficientScope ? yield* fromPromise(() => provider.tokens()) : undefined;
      const result = yield* authorizeMcp(provider, {
        fetch: context.fetch,
        resourceMetadataUrl: challenge.resourceMetadataUrl,
        scope: insufficientScope ? stepUpScope(granted?.scope, challenge.scope) : challenge.scope,
        serverUrl: context.serverUrl,
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
    onUnauthorized: (context: authProviderTypes.UnauthorizedContext) =>
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
    token: () => toPromise(accessToken(provider)),
  };
}

const adapter = {
  adaptOAuthProvider,
};

export default adapter;
