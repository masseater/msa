import { Console, Effect } from "effect";

import type { ClassifierModel, Model } from "../../src/types.ts";
import { type AiGatewayPricing, getAiGatewayCost } from "../ai-gateway-pricing.ts";
import { roundCost } from "./models-dev.ts";
import { fetchJson, withFallback } from "./upstream.ts";

interface AiGatewayModel {
  id: string;
  name?: string;
  type?: string;
  context_window?: number;
  max_tokens?: number;
  tags?: string[];
  pricing?: AiGatewayPricing;
}

export interface AiGatewayCatalog {
  readonly chat: Model<any>[];
  readonly classifiers: ClassifierModel<"typesafe-system-one">[];
}

const AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1";
const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";
const AI_GATEWAY_TYPESAFE_BASE_URL = "https://ai-gateway.vercel.sh/typesafe/v1";

const toNumber = (value: string | number | undefined): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
};

const aiGatewayClassifier = (model: AiGatewayModel): ClassifierModel<"typesafe-system-one"> => ({
  type: "classifier",
  id: model.id,
  name: model.name || model.id,
  api: "typesafe-system-one",
  provider: "vercel-ai-gateway",
  baseUrl: AI_GATEWAY_TYPESAFE_BASE_URL,
  input: ["text"],
  cost: {
    input: roundCost(toNumber(model.pricing?.input) * 1_000_000),
    output: roundCost(toNumber(model.pricing?.output) * 1_000_000),
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: model.context_window || 4096,
});

const aiGatewayChatModel = (model: AiGatewayModel, tags: readonly string[]): Model<any> => ({
  id: model.id,
  name: model.name || model.id,
  api: "anthropic-messages",
  baseUrl: AI_GATEWAY_BASE_URL,
  provider: "vercel-ai-gateway",
  reasoning: tags.includes("reasoning"),
  input: tags.includes("vision") ? ["text", "image"] : ["text"],
  compat: { allowEmptySignature: true },
  cost: getAiGatewayCost(model.pricing),
  contextWindow: model.context_window || 4096,
  maxTokens: model.max_tokens || 4096,
});

function aiGatewayCatalog(items: readonly AiGatewayModel[]): AiGatewayCatalog {
  const chat: Model<any>[] = [];
  const classifiers: ClassifierModel<"typesafe-system-one">[] = [];
  for (const model of items) {
    if (model.type === "evaluation") {
      classifiers.push(aiGatewayClassifier(model));
      continue;
    }
    const tags = Array.isArray(model.tags) ? model.tags : [];
    if (tags.includes("tool-use")) chat.push(aiGatewayChatModel(model, tags));
  }
  return { chat, classifiers };
}

export const fetchAiGatewayModels = (strict: boolean) =>
  Effect.gen(function* () {
    yield* Console.log("Fetching models from Vercel AI Gateway API...");
    const data = (yield* fetchJson({
      url: `${AI_GATEWAY_MODELS_URL}/models`,
      label: "Vercel AI Gateway API",
    })) as { data?: unknown };
    const catalog = aiGatewayCatalog(
      Array.isArray(data.data) ? (data.data as AiGatewayModel[]) : [],
    );
    yield* Console.log(
      `Fetched ${catalog.chat.length} tool-capable and ${catalog.classifiers.length} classifier models from Vercel AI Gateway`,
    );
    return catalog;
  }).pipe(
    withFallback({
      label: "fetch Vercel AI Gateway models",
      strict,
      fallback: (): AiGatewayCatalog => ({ chat: [], classifiers: [] }),
    }),
  );
