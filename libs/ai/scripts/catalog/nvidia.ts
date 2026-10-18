import { Console, Effect } from "effect";

import type { Api, Model, OpenAICompletionsCompat } from "../../src/types.ts";
import { modelsDevFields, type ModelsDevSource, toolModels } from "./models-dev.ts";
import { fetchJson, withFallback } from "./upstream.ts";

interface NvidiaNimModelListItem {
  id: string;
}

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

const NVIDIA_HEADERS = {
  "NVCF-POLL-SECONDS": "3600",
} as const;

const NVIDIA_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
};

const NVIDIA_NIM_UNSUPPORTED_MODELS = new Set([
  "abacusai/dracarys-llama-3.1-70b-instruct",
  "bytedance/seed-oss-36b-instruct",
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro",
  "google/gemma-2-2b-it",
  "google/gemma-3n-e2b-it",
  "google/gemma-3n-e4b-it",
  "google/gemma-4-31b-it",
  "meta/llama-3.2-1b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "microsoft/phi-4-mini-instruct",
  "minimaxai/minimax-m2.7",
  "mistralai/mistral-nemotron",
  "nvidia/nemotron-mini-4b-instruct",
  "qwen/qwen3-next-80b-a3b-instruct",
  "qwen/qwen3.5-397b-a17b",
  "sarvamai/sarvam-m",
  "upstage/solar-10.7b-instruct",
]);

function normalizeNvidiaModelId(modelId: string): string {
  return modelId.toLowerCase().replaceAll("_", ".");
}

const fetchNvidiaNimModelIds = (strict: boolean) =>
  Effect.gen(function* () {
    yield* Console.log("Fetching models from NVIDIA NIM API...");
    const data = (yield* fetchJson({
      url: `${NVIDIA_BASE_URL}/models`,
      label: "NVIDIA NIM API",
    })) as { data?: NvidiaNimModelListItem[] };
    const modelIds = new Map<string, string>();
    for (const model of data.data ?? []) {
      modelIds.set(model.id, model.id);
      modelIds.set(normalizeNvidiaModelId(model.id), model.id);
    }
    yield* Console.log(`Fetched ${data.data?.length ?? 0} model IDs from NVIDIA NIM`);
    return modelIds;
  }).pipe(
    withFallback({
      label: "fetch NVIDIA NIM models",
      strict,
      fallback: () => new Map<string, string>(),
    }),
  );

export const nvidiaModels = Effect.fn("nvidiaModels")(function* ({
  data,
  strict,
  remember,
}: ModelsDevSource) {
  if (data["nvidia"]?.models === undefined) return [];
  const liveModelIds = yield* fetchNvidiaNimModelIds(strict);
  return toolModels(data["nvidia"]).flatMap(([modelId, source]): Model<Api>[] => {
    if (source.modalities?.input?.includes("text") !== true) return [];
    if (source.modalities.output?.includes("text") !== true) return [];
    const id = liveModelIds.get(modelId) ?? liveModelIds.get(normalizeNvidiaModelId(modelId));
    if (id === undefined || id === "" || NVIDIA_NIM_UNSUPPORTED_MODELS.has(id)) return [];
    remember("nvidia", id, source);
    return [
      {
        ...modelsDevFields({ id, source }),
        api: "openai-completions",
        provider: "nvidia",
        baseUrl: NVIDIA_BASE_URL,
        headers: { ...NVIDIA_HEADERS },
        compat: NVIDIA_OPENAI_COMPAT,
      },
    ];
  });
});
