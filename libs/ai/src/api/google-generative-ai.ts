import { GoogleGenAI } from "@google/genai";

import type {
  Model,
  ProviderHeaders,
  SimpleStreamOptions,
  StreamFunction,
  ThinkingBudgets,
  TranscriptContext,
} from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import { modelCall } from "../utils/model-call.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import type { GoogleRequestOptions } from "./google-params.ts";
import { googleSimpleOptions } from "./google-simple-options.ts";
import { runGoogleStream } from "./google-stream.ts";
import type { ResolvedGoogleThinkingLevel } from "./google-thinking.ts";

export interface GoogleOptions extends GoogleRequestOptions {}

function createClient(
  model: Model<"google-generative-ai">,
  apiKey: string,
  optionsHeaders?: ProviderHeaders,
): GoogleGenAI {
  const httpOptions: { baseUrl?: string; apiVersion?: string; headers?: Record<string, string> } =
    {};
  if (model.baseUrl !== "") {
    httpOptions.baseUrl = model.baseUrl;
    httpOptions.apiVersion = "";
  }
  const headers = providerHeadersToRecord({
    "User-Agent": getMsaUserAgent(),
    ...model.headers,
    ...optionsHeaders,
  });
  if (headers !== undefined) {
    httpOptions.headers = headers;
  }
  return new GoogleGenAI({
    apiKey,
    ...(Object.keys(httpOptions).length > 0 ? { httpOptions } : {}),
  });
}

function requireApiKey(model: Model<"google-generative-ai">, apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  return apiKey;
}

const GEMINI_25_BUDGETS: readonly [string, Record<ResolvedGoogleThinkingLevel, number>][] = [
  ["2.5-pro", { minimal: 128, low: 2048, medium: 8192, high: 32768 }],
  ["2.5-flash-lite", { minimal: 512, low: 2048, medium: 8192, high: 24576 }],
  ["2.5-flash", { minimal: 128, low: 2048, medium: 8192, high: 24576 }],
];

const googleBudget =
  (model: Model<"google-generative-ai">) =>
  (level: ResolvedGoogleThinkingLevel, customBudgets: ThinkingBudgets | undefined): number => {
    const custom = customBudgets?.[level];
    if (custom !== undefined) return custom;
    const match = GEMINI_25_BUDGETS.find(([marker]) => model.id.includes(marker));
    return match === undefined ? -1 : match[1][level];
  };

export const stream = modelCall<
  Parameters<StreamFunction<"google-generative-ai", GoogleOptions>>[0],
  Parameters<StreamFunction<"google-generative-ai", GoogleOptions>>[1],
  NonNullable<Parameters<StreamFunction<"google-generative-ai", GoogleOptions>>[2]>,
  ReturnType<StreamFunction<"google-generative-ai", GoogleOptions>>
>(
  (
    model: Model<"google-generative-ai">,
    context: TranscriptContext,
    options?: GoogleOptions,
  ): AssistantMessageEventStream =>
    runGoogleStream({
      model,
      context,
      options,
      adapterName: "Google Generative AI",
      streamName: "Google",
      createClient: (requestOptions) =>
        createClient(model, requireApiKey(model, requestOptions?.apiKey), requestOptions?.headers),
    }),
);

export const streamSimple = modelCall<
  Parameters<StreamFunction<"google-generative-ai", SimpleStreamOptions>>[0],
  Parameters<StreamFunction<"google-generative-ai", SimpleStreamOptions>>[1],
  NonNullable<Parameters<StreamFunction<"google-generative-ai", SimpleStreamOptions>>[2]>,
  ReturnType<StreamFunction<"google-generative-ai", SimpleStreamOptions>>
>(
  (
    model: Model<"google-generative-ai">,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const apiKey = requireApiKey(model, options?.apiKey);
    return stream(
      model,
      context,
      googleSimpleOptions({ model, context, options, apiKey, budgetFor: googleBudget(model) }),
    );
  },
);
