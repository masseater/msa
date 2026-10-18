import type {
  Model,
  SimpleStreamOptions,
  StreamFunction,
  ThinkingBudgets,
  TranscriptContext,
} from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { modelCall } from "../utils/model-call.ts";
import type { GoogleRequestOptions } from "./google-params.ts";
import { googleSimpleOptions } from "./google-simple-options.ts";
import { runGoogleStream } from "./google-stream.ts";
import type { ResolvedGoogleThinkingLevel } from "./google-thinking.ts";
import { createVertexClient, type VertexClientOptions } from "./google-vertex-client.ts";

export interface GoogleVertexOptions extends GoogleRequestOptions, VertexClientOptions {}

const GEMINI_25_BUDGETS: readonly [string, Record<ResolvedGoogleThinkingLevel, number>][] = [
  ["2.5-pro", { minimal: 128, low: 2048, medium: 8192, high: 32768 }],
  ["2.5-flash", { minimal: 128, low: 2048, medium: 8192, high: 24576 }],
];

const vertexBudget =
  (model: Model<"google-vertex">) =>
  (level: ResolvedGoogleThinkingLevel, customBudgets: ThinkingBudgets | undefined): number => {
    const custom = customBudgets?.[level];
    if (custom !== undefined) return custom;
    const match = GEMINI_25_BUDGETS.find(([marker]) => model.id.includes(marker));
    return match === undefined ? -1 : match[1][level];
  };

export const stream = modelCall<
  Parameters<StreamFunction<"google-vertex", GoogleVertexOptions>>[0],
  Parameters<StreamFunction<"google-vertex", GoogleVertexOptions>>[1],
  NonNullable<Parameters<StreamFunction<"google-vertex", GoogleVertexOptions>>[2]>,
  ReturnType<StreamFunction<"google-vertex", GoogleVertexOptions>>
>(
  (
    model: Model<"google-vertex">,
    context: TranscriptContext,
    options?: GoogleVertexOptions,
  ): AssistantMessageEventStream =>
    runGoogleStream({
      model,
      context,
      options,
      adapterName: "Google Vertex",
      streamName: "Google Vertex",
      createClient: createVertexClient(model),
    }),
);

export const streamSimple = modelCall<
  Parameters<StreamFunction<"google-vertex", SimpleStreamOptions>>[0],
  Parameters<StreamFunction<"google-vertex", SimpleStreamOptions>>[1],
  NonNullable<Parameters<StreamFunction<"google-vertex", SimpleStreamOptions>>[2]>,
  ReturnType<StreamFunction<"google-vertex", SimpleStreamOptions>>
>(
  (
    model: Model<"google-vertex">,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    stream(
      model,
      context,
      googleSimpleOptions({
        model,
        context,
        options,
        apiKey: undefined,
        budgetFor: vertexBudget(model),
      }),
    ),
);
