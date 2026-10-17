import { Effect } from "effect";

import { bedrockConverseStreamApi } from "../api/bedrock-converse-stream.lazy.ts";
import { promptUser, authEnv, throwIfAborted } from "../auth/helpers.ts";
import type {
  ApiKeyAuth,
  ApiKeyCredential,
  AuthContext,
  ProviderAuthInteraction,
} from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import { AMAZON_BEDROCK_MODELS } from "./amazon-bedrock.models.ts";

const isPresent = (value: string | undefined): boolean => value !== undefined && value !== "";

const BEDROCK_AUTH_METHODS = [
  { id: "bearer-token", label: "Bearer token" },
  { id: "aws-profile", label: "AWS profile" },
  { id: "credential-chain", label: "Existing AWS credential chain" },
];

const loginBedrock = Effect.fn("loginBedrock")(function* (interaction: ProviderAuthInteraction) {
  yield* throwIfAborted(interaction.signal);
  const method = yield* promptUser(interaction, {
    type: "select",
    message: "Select Amazon Bedrock authentication method:",
    options: BEDROCK_AUTH_METHODS,
  });
  yield* throwIfAborted(interaction.signal);
  if (method === "bearer-token") {
    const key = yield* promptUser(interaction, {
      type: "secret",
      message: "Enter Amazon Bedrock bearer token",
    });
    return { type: "api_key", key } satisfies ApiKeyCredential;
  }
  interaction.notify({
    type: "info",
    message: "Amazon Bedrock supports AWS profiles, IAM credentials, and role-based credentials.",
    links: [
      {
        label: "AWS credential provider chain",
        url: "https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html",
      },
    ],
  });
  if (method === "aws-profile") {
    const profile = yield* promptUser(interaction, {
      type: "text",
      message: "Enter AWS profile name",
    });
    return { type: "api_key", env: { AWS_PROFILE: profile } } satisfies ApiKeyCredential;
  }
  if (method !== "credential-chain")
    return yield* Effect.die(new Error(`Unknown Amazon Bedrock auth method: ${method}`));
  yield* promptUser(interaction, {
    type: "text",
    message: "Configure AWS credentials, then press Enter to continue",
  });
  return { type: "api_key" } satisfies ApiKeyCredential;
});

const AMBIENT_CREDENTIAL_SOURCES = [
  ["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "ECS task role"],
  ["AWS_CONTAINER_CREDENTIALS_FULL_URI", "ECS task role"],
  ["AWS_WEB_IDENTITY_TOKEN_FILE", "web identity token"],
] as const;

const resolveBedrock = Effect.fn("resolveBedrock")(function* (input: {
  ctx: AuthContext;
  credential?: ApiKeyCredential | undefined;
  signal: AbortSignal;
}) {
  const { credential } = input;
  const env = authEnv(input);
  if (credential?.key !== undefined && credential?.key !== "") {
    return { auth: { apiKey: credential.key }, env: credential.env, source: "stored credential" };
  }
  if (isPresent(yield* env("AWS_BEARER_TOKEN_BEDROCK")))
    return { auth: {}, source: "AWS_BEARER_TOKEN_BEDROCK" };
  const storedProfile = credential?.env?.["AWS_PROFILE"];
  if (isPresent(storedProfile ?? (yield* env("AWS_PROFILE")))) {
    return {
      auth: {},
      env: credential?.env,
      source: isPresent(storedProfile) ? "stored credential" : "AWS_PROFILE",
    };
  }
  if (isPresent(yield* env("AWS_ACCESS_KEY_ID")) && isPresent(yield* env("AWS_SECRET_ACCESS_KEY")))
    return { auth: {}, source: "AWS access keys" };
  for (const [name, source] of AMBIENT_CREDENTIAL_SOURCES) {
    if (isPresent(yield* env(name))) return { auth: {}, source };
  }
  return undefined;
});

const bedrockAuth: ApiKeyAuth = {
  name: "AWS credentials or bearer token",
  login: (interaction) => Effect.runPromise(loginBedrock(interaction)),
  resolve: (input) => Effect.runPromise(resolveBedrock(input)),
};

export function amazonBedrockProvider(): Provider<"bedrock-converse-stream"> {
  return createProvider({
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    auth: { apiKey: bedrockAuth },
    models: Object.values(AMAZON_BEDROCK_MODELS),
    api: bedrockConverseStreamApi(),
  });
}
