import { GoogleGenAI } from "@google/genai";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import headersModule from "../utils/headers.ts";
import modelCallModule from "../utils/model-call.ts";
import userAgent from "../utils/user-agent.ts";
import type googleGenerativeAiTypes from "./google-generative-ai.types.ts";
import googleSimpleOptionsModule from "./google-simple-options.ts";
import googleStreamModule from "./google-stream.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";

const { providerHeadersToRecord } = headersModule;
const { getMsaUserAgent } = userAgent;
const { modelCall } = modelCallModule;
const { runGoogleStream } = googleStreamModule;
const { googleSimpleOptions } = googleSimpleOptionsModule;

function createClient(
  model: typesModule.Model<"google-generative-ai">,
  apiKey: string,
  optionsHeaders?: typesModule.ProviderHeaders,
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

function requireApiKey(
  model: typesModule.Model<"google-generative-ai">,
  apiKey: string | undefined,
): string {
  if (apiKey === undefined || apiKey === "") {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  return apiKey;
}

const GEMINI_25_BUDGETS: readonly [
  string,
  Record<googleThinkingTypes.ResolvedGoogleThinkingLevel, number>,
][] = [
  ["2.5-pro", { high: 32768, low: 2048, medium: 8192, minimal: 128 }],
  ["2.5-flash-lite", { high: 24576, low: 2048, medium: 8192, minimal: 512 }],
  ["2.5-flash", { high: 24576, low: 2048, medium: 8192, minimal: 128 }],
];

const googleBudget =
  (model: typesModule.Model<"google-generative-ai">) =>
  (
    level: googleThinkingTypes.ResolvedGoogleThinkingLevel,
    customBudgets: typesModule.ThinkingBudgets | undefined,
  ): number => {
    const custom = customBudgets?.[level];
    if (custom !== undefined) return custom;
    const match = GEMINI_25_BUDGETS.find(([marker]) => model.id.includes(marker));
    return match === undefined ? -1 : match[1][level];
  };

const stream = modelCall<
  Parameters<
    typesModule.StreamFunction<"google-generative-ai", googleGenerativeAiTypes.GoogleOptions>
  >[0],
  Parameters<
    typesModule.StreamFunction<"google-generative-ai", googleGenerativeAiTypes.GoogleOptions>
  >[1],
  NonNullable<
    Parameters<
      typesModule.StreamFunction<"google-generative-ai", googleGenerativeAiTypes.GoogleOptions>
    >[2]
  >,
  ReturnType<
    typesModule.StreamFunction<"google-generative-ai", googleGenerativeAiTypes.GoogleOptions>
  >
>(
  (
    model: typesModule.Model<"google-generative-ai">,
    context: typesModule.TranscriptContext,
    options?: googleGenerativeAiTypes.GoogleOptions,
  ): eventStreamTypes.AssistantMessageEventStream =>
    runGoogleStream({
      adapterName: "Google Generative AI",
      context,
      createClient: (requestOptions) =>
        createClient(model, requireApiKey(model, requestOptions?.apiKey), requestOptions?.headers),
      model,
      options,
      streamName: "Google",
    }),
);

const streamSimple = modelCall<
  Parameters<
    typesModule.StreamFunction<"google-generative-ai", typesModule.SimpleStreamOptions>
  >[0],
  Parameters<
    typesModule.StreamFunction<"google-generative-ai", typesModule.SimpleStreamOptions>
  >[1],
  NonNullable<
    Parameters<
      typesModule.StreamFunction<"google-generative-ai", typesModule.SimpleStreamOptions>
    >[2]
  >,
  ReturnType<typesModule.StreamFunction<"google-generative-ai", typesModule.SimpleStreamOptions>>
>(
  (
    model: typesModule.Model<"google-generative-ai">,
    context: typesModule.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
  ): eventStreamTypes.AssistantMessageEventStream => {
    const apiKey = requireApiKey(model, options?.apiKey);
    return stream(
      model,
      context,
      googleSimpleOptions({ apiKey, budgetFor: googleBudget(model), context, model, options }),
    );
  },
);

const googleGenerativeAi = {
  stream,
  streamSimple,
};

export default googleGenerativeAi;
