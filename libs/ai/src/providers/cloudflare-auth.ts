import { Effect } from "effect";

import { promptUser, authEnv } from "../auth/helpers.ts";
import type { ApiKeyAuth, ApiKeyCredential, AuthContext } from "../auth/types.ts";

const CLOUDFLARE_API_KEY = "CLOUDFLARE_API_KEY";
const CLOUDFLARE_ACCOUNT_ID = "CLOUDFLARE_ACCOUNT_ID";
const CLOUDFLARE_GATEWAY_ID = "CLOUDFLARE_GATEWAY_ID";

type CloudflareAuthKind = "workers-ai" | "ai-gateway";

function resolveValue(
  name: string,
  ctx: AuthContext,
  credential: ApiKeyCredential | undefined,
  signal: AbortSignal,
): Effect.Effect<string | undefined> {
  const fromCredential =
    credential === undefined
      ? undefined
      : name === CLOUDFLARE_API_KEY
        ? credential.key
        : credential.env?.[name];
  if (fromCredential !== undefined) return Effect.succeed(fromCredential);
  return authEnv({ ctx, signal })(name);
}

const resolveCloudflareEnv = Effect.fn("resolveCloudflareEnv")(function* (
  kind: CloudflareAuthKind,
  ctx: AuthContext,
  credential: ApiKeyCredential | undefined,
  signal: AbortSignal,
) {
  const apiKey = yield* resolveValue(CLOUDFLARE_API_KEY, ctx, credential, signal);
  const accountId = yield* resolveValue(CLOUDFLARE_ACCOUNT_ID, ctx, credential, signal);
  const gatewayId =
    kind === "ai-gateway"
      ? yield* resolveValue(CLOUDFLARE_GATEWAY_ID, ctx, credential, signal)
      : undefined;

  if (
    apiKey === undefined ||
    apiKey === "" ||
    accountId === undefined ||
    accountId === "" ||
    (kind === "ai-gateway" && (gatewayId === undefined || gatewayId === ""))
  )
    return undefined;

  return {
    apiKey,
    env: {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      ...(gatewayId !== undefined && gatewayId !== "" ? { CLOUDFLARE_GATEWAY_ID: gatewayId } : {}),
    },
    source: credential === undefined ? CLOUDFLARE_API_KEY : "stored credential",
  };
});

export function cloudflareWorkersAIAuth(): ApiKeyAuth {
  return {
    name: "Cloudflare API key",
    login: (interaction) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const key = yield* promptUser(interaction, {
            type: "secret",
            message: "Enter Cloudflare API key",
          });
          const accountId = yield* promptUser(interaction, {
            type: "text",
            message: "Enter Cloudflare account ID",
          });
          return { type: "api_key", key, env: { CLOUDFLARE_ACCOUNT_ID: accountId } } as const;
        }),
      ),
    resolve: ({ ctx, credential, signal }) =>
      Effect.runPromise(
        Effect.map(resolveCloudflareEnv("workers-ai", ctx, credential, signal), (resolved) =>
          resolved === undefined
            ? undefined
            : {
                auth: { apiKey: resolved.apiKey },
                env: resolved.env,
                source: resolved.source,
              },
        ),
      ),
  };
}

export function cloudflareAIGatewayAuth(): ApiKeyAuth {
  return {
    name: "Cloudflare API key",
    login: (interaction) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const key = yield* promptUser(interaction, {
            type: "secret",
            message: "Enter Cloudflare API key",
          });
          const accountId = yield* promptUser(interaction, {
            type: "text",
            message: "Enter Cloudflare account ID",
          });
          const gatewayId = yield* promptUser(interaction, {
            type: "text",
            message: "Enter Cloudflare AI Gateway ID",
          });
          return {
            type: "api_key",
            key,
            env: { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_GATEWAY_ID: gatewayId },
          } as const;
        }),
      ),
    resolve: ({ ctx, credential, signal }) =>
      Effect.runPromise(
        Effect.map(resolveCloudflareEnv("ai-gateway", ctx, credential, signal), (resolved) =>
          resolved === undefined
            ? undefined
            : {
                auth: {
                  headers: {
                    "cf-aig-authorization": `Bearer ${resolved.apiKey}`,
                    Authorization: null,
                    "x-api-key": null,
                  },
                },
                env: resolved.env,
                source: resolved.source,
              },
        ),
      ),
  };
}
