import {
  CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL,
  CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
  CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL,
} from "../../src/api/cloudflare.ts";
import type { Api, Model } from "../../src/types.ts";
import { modelsDevFields, type ModelsDevSource, toolModels } from "./models-dev.ts";

interface GatewayRoute {
  readonly api: "anthropic-messages" | "openai-completions" | "openai-responses";
  readonly baseUrl: string;
  readonly id: string;
  readonly affinity: boolean;
}

function gatewayRoute(prefixedId: string): GatewayRoute | undefined {
  const slashIdx = prefixedId.indexOf("/");
  if (slashIdx === -1) return undefined;
  const upstream = prefixedId.slice(0, slashIdx);
  const nativeId = prefixedId.slice(slashIdx + 1);
  switch (upstream) {
    case "openai":
      return {
        api: "openai-responses",
        baseUrl: CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL,
        id: nativeId,
        affinity: false,
      };
    case "anthropic":
      return {
        api: "anthropic-messages",
        baseUrl: CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL,
        id: nativeId.replaceAll(".", "-"),
        affinity: true,
      };
    case "workers-ai":
      return {
        api: "openai-completions",
        baseUrl: CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
        id: prefixedId,
        affinity: true,
      };
    default:
      return undefined;
  }
}

export function cloudflareAiGatewayModels({ data, remember }: ModelsDevSource): Model<Api>[] {
  const models: Model<Api>[] = [];
  const seen = new Set<string>();
  for (const [prefixedId, source] of toolModels(data["cloudflare-ai-gateway"])) {
    const route = gatewayRoute(prefixedId);
    if (route === undefined) continue;
    seen.add(route.id);
    models.push({
      ...modelsDevFields({ id: route.id, source }),
      api: route.api,
      provider: "cloudflare-ai-gateway",
      baseUrl: route.baseUrl,
      ...(route.affinity ? { compat: { sendSessionAffinityHeaders: true } } : {}),
    });
    remember("cloudflare-ai-gateway", route.id, source);
  }
  for (const [modelId, source] of toolModels(data["cloudflare-workers-ai"])) {
    const id = `workers-ai/${modelId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({
      ...modelsDevFields({ id, source }),
      api: "openai-completions",
      provider: "cloudflare-ai-gateway",
      baseUrl: CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
      compat: { sendSessionAffinityHeaders: true },
    });
    remember("cloudflare-ai-gateway", id, source);
  }
  return models;
}
