import { Effect } from "effect";

import { googleVertexApi } from "../api/google-vertex.lazy.ts";
import { authEnv, promptUser, throwIfAborted } from "../auth/helpers.ts";
import type {
  ApiKeyAuth,
  ApiKeyCredential,
  AuthContext,
  ProviderAuthInteraction,
} from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import { GOOGLE_VERTEX_MODELS } from "./google-vertex.models.ts";

const VERTEX_ADC_PATH = "~/.config/gcloud/application_default_credentials.json";

const isPresent = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const promptVertexEnv = Effect.fn("promptVertexEnv")(function* (
  interaction: ProviderAuthInteraction,
  method: "adc" | "service-account",
) {
  interaction.notify({
    type: "info",
    message:
      method === "adc"
        ? "Run `gcloud auth application-default login`, then provide the project and location."
        : "Provide a service account credentials file, project, and location.",
    links: [
      {
        label: "Application Default Credentials",
        url: "https://cloud.google.com/docs/authentication/provide-credentials-adc",
      },
    ],
  });
  const project = yield* promptUser(interaction, {
    type: "text",
    message: "Enter Google Cloud project ID",
  });
  const location = yield* promptUser(interaction, {
    type: "text",
    message: "Enter Google Cloud location",
  });
  const credentialsPath =
    method === "service-account"
      ? yield* promptUser(interaction, {
          type: "text",
          message: "Enter service account credentials file path",
        })
      : undefined;
  return {
    GOOGLE_CLOUD_PROJECT: project,
    GOOGLE_CLOUD_LOCATION: location,
    ...(isPresent(credentialsPath) ? { GOOGLE_APPLICATION_CREDENTIALS: credentialsPath } : {}),
  };
});

const loginVertex = Effect.fn("loginVertex")(function* (interaction: ProviderAuthInteraction) {
  yield* throwIfAborted(interaction.signal);
  const method = yield* promptUser(interaction, {
    type: "select",
    message: "Select Google Vertex AI authentication method:",
    options: [
      { id: "api-key", label: "Google Cloud API key" },
      { id: "adc", label: "Application Default Credentials" },
      { id: "service-account", label: "Service account credentials file" },
    ],
  });
  yield* throwIfAborted(interaction.signal);
  if (method === "api-key") {
    const key = yield* promptUser(interaction, {
      type: "secret",
      message: "Enter Google Cloud API key",
    });
    return { type: "api_key", key } satisfies ApiKeyCredential;
  }
  if (method !== "adc" && method !== "service-account") {
    return yield* Effect.die(new Error(`Unknown Google Vertex AI auth method: ${method}`));
  }
  const env = yield* promptVertexEnv(interaction, method);
  return { type: "api_key", env } satisfies ApiKeyCredential;
});

const resolveVertex = Effect.fn("resolveVertex")(function* (input: {
  ctx: AuthContext;
  credential?: ApiKeyCredential | undefined;
  signal: AbortSignal;
}) {
  const { ctx, credential, signal } = input;
  const env = authEnv(input);
  const key = credential?.key ?? (yield* env("GOOGLE_CLOUD_API_KEY"));
  if (isPresent(key))
    return {
      auth: { apiKey: key },
      source: isPresent(credential?.key) ? "stored credential" : "GOOGLE_CLOUD_API_KEY",
    };

  const adcPath =
    credential?.env?.["GOOGLE_APPLICATION_CREDENTIALS"] ??
    (yield* env("GOOGLE_APPLICATION_CREDENTIALS"));
  yield* throwIfAborted(signal);
  const hasCredentials = yield* Effect.promise(() => ctx.fileExists(adcPath ?? VERTEX_ADC_PATH));
  yield* throwIfAborted(signal);
  const project =
    credential?.env?.["GOOGLE_CLOUD_PROJECT"] ??
    (yield* env("GOOGLE_CLOUD_PROJECT")) ??
    (yield* env("GCLOUD_PROJECT"));
  const location =
    credential?.env?.["GOOGLE_CLOUD_LOCATION"] ?? (yield* env("GOOGLE_CLOUD_LOCATION"));
  if (hasCredentials && isPresent(project) && isPresent(location)) {
    return {
      auth: {},
      env: credential?.env,
      source:
        credential === undefined ? "gcloud application default credentials" : "stored credential",
    };
  }
  return undefined;
});

const vertexAuth: ApiKeyAuth = {
  name: "Google Cloud credentials",
  login: (interaction) => Effect.runPromise(loginVertex(interaction)),
  resolve: (input) => Effect.runPromise(resolveVertex(input)),
};

export function googleVertexProvider(): Provider<"google-vertex"> {
  return createProvider({
    id: "google-vertex",
    name: "Google Vertex AI",
    auth: { apiKey: vertexAuth },
    models: Object.values(GOOGLE_VERTEX_MODELS),
    api: googleVertexApi(),
  });
}
