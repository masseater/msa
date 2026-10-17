import { Effect, Function } from "effect";

import type { OAuthCredential } from "../auth/types.ts";
import type { Model, ThinkingLevelMap } from "../types.ts";
import { httpRequest } from "../utils/http.ts";

export const DEFAULT_RADIUS_GATEWAY = "https://radius.pi.dev";

export type RadiusGatewayModel = {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input: ("text" | "image")[];
  cost: Model<"msa-messages">["cost"];
  contextWindow: number;
  maxTokens: number;
};

export type RadiusGatewayConfig = {
  baseUrl: string;
  models: RadiusGatewayModel[];
};

export type RadiusOAuthCredential = OAuthCredential & {
  gatewayConfig?: RadiusGatewayConfig;
};

function isRadiusGatewayModel(value: unknown): value is RadiusGatewayModel {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const model = value as Partial<RadiusGatewayModel>;
  return (
    typeof model.id === "string" &&
    typeof model.name === "string" &&
    typeof model.reasoning === "boolean" &&
    Array.isArray(model.input) &&
    typeof model.cost === "object" &&
    model.cost !== null &&
    !Array.isArray(model.cost) &&
    typeof model.contextWindow === "number" &&
    typeof model.maxTokens === "number"
  );
}

function sanitizeRadiusGatewayConfig(config: unknown): RadiusGatewayConfig | undefined {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return undefined;
  const { baseUrl, models } = config as Partial<RadiusGatewayConfig>;
  if (typeof baseUrl !== "string" || !Array.isArray(models)) return undefined;
  return {
    baseUrl,
    models: models.filter(isRadiusGatewayModel).map((model) => Object.assign({}, model)),
  };
}

export function normalizeRadiusGatewayUrl(value: string): string {
  const withScheme = /^https?:\/\//iu.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/u, "");
}

export function getRadiusCredentialConfig(
  credential: OAuthCredential | undefined,
): RadiusGatewayConfig | undefined {
  return sanitizeRadiusGatewayConfig(
    (credential as RadiusOAuthCredential | undefined)?.gatewayConfig,
  );
}

export const getRadiusModelsFromConfig: {
  (config: RadiusGatewayConfig): (providerId: string) => Model<"msa-messages">[];
  (providerId: string, config: RadiusGatewayConfig): Model<"msa-messages">[];
} = Function.dual(
  2,
  function (providerId: string, config: RadiusGatewayConfig): Model<"msa-messages">[] {
    return config.models.map((model) => ({
      ...model,
      api: "msa-messages",
      provider: providerId,
      baseUrl: config.baseUrl,
    }));
  },
);

export const getRadiusModels: {
  (credential: OAuthCredential | undefined): (providerId: string) => Model<"msa-messages">[];
  (providerId: string, credential: OAuthCredential | undefined): Model<"msa-messages">[];
} = Function.dual(
  2,
  function (providerId: string, credential: OAuthCredential | undefined): Model<"msa-messages">[] {
    const config = getRadiusCredentialConfig(credential);
    return config === undefined ? [] : getRadiusModelsFromConfig(providerId, config);
  },
);

function truncateHttpBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 512 ? `${trimmed.slice(0, 512)}…` : trimmed;
}

export interface RadiusGatewayConfigRequest {
  readonly gateway: string;
  readonly apiKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export const loadRadiusGatewayConfig = Effect.fn("loadRadiusGatewayConfig")(function* ({
  gateway,
  apiKey,
  signal,
}: RadiusGatewayConfigRequest) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey !== undefined && apiKey !== "") headers["authorization"] = `Bearer ${apiKey}`;
  const reply = yield* httpRequest({ url: new URL("/v1/config", gateway), headers, signal });
  if (!reply.ok) {
    throw new Error(
      `Could not load Radius config from ${gateway}: ${reply.status}: ${truncateHttpBody(yield* reply.text)}`,
    );
  }
  const config = sanitizeRadiusGatewayConfig(yield* reply.json);
  if (config === undefined) throw new Error(`Invalid Radius config from ${gateway}`);
  return config;
});
