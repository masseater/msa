import { Clock, Effect, Stream } from "effect";
import { Type } from "typebox";
import { beforeEach, expect } from "vite-plus/test";

import { type AssistantMessageEventStream, streamSimple } from "../src/compat.ts";
import type {
  Api,
  AssistantMessage,
  Model,
  OpenAICompletionsCompat,
  SimpleStreamOptions,
  Tool,
} from "../src/types.ts";
import modelChoice from "./model-choice.ts";
import openaiCompletionsToolChoiceMock from "./openai-completions-tool-choice-mock.ts";

const { chooseModel } = modelChoice;
const { mockState } = openaiCompletionsToolChoiceMock;

interface CompletionsPayload {
  readonly [field: string]: unknown;
  readonly messages?: Array<Record<string, unknown>>;
  readonly tool_choice?: unknown;
  readonly tools?: Array<{
    readonly function?: {
      readonly name?: string;
      readonly parameters?: { readonly required?: string[] };
      readonly strict?: boolean;
    };
  }>;
}

const localOpenAICompletionsModel = {
  api: "openai-completions",
  baseUrl: "http://localhost:8000/v1",
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  input: ["text"],
  maxTokens: 8192,
  provider: "local-vllm",
  reasoning: true,
} satisfies Omit<Model<"openai-completions">, "id" | "name" | "compat">;

const directCompletionsModel = (compat?: OpenAICompletionsCompat): Model<"openai-completions"> => {
  const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
  return { ...baseModel, api: "openai-completions", ...(compat === undefined ? {} : { compat }) };
};

const pingTool: Tool = {
  description: "Ping tool",
  name: "ping",
  parameters: Type.Object({ ok: Type.Boolean() }),
};

const optionalFieldTool: Tool = {
  constrainedSampling: { strict: "prefer", type: "json_schema" },
  description: "Ping tool",
  name: "ping",
  parameters: Type.Object({
    optional: Type.Optional(Type.String()),
    required: Type.String(),
  }),
};

const promptModel = Effect.fn("promptModel")(function* (
  model: Model<Api>,
  content: string,
  request: {
    readonly options?: SimpleStreamOptions;
    readonly systemPrompt?: string;
    readonly tools?: Tool[];
  } = {},
) {
  const captured: { payload?: unknown } = {};
  const timestamp = yield* Clock.currentTimeMillis;
  const response = yield* Effect.promise(() =>
    streamSimple(
      model,
      {
        messages: [{ content, role: "user", timestamp }],
        ...(request.systemPrompt === undefined ? {} : { systemPrompt: request.systemPrompt }),
        ...(request.tools === undefined ? {} : { tools: request.tools }),
      },
      {
        apiKey: "test",
        onPayload: (payload: unknown) => {
          captured.payload = payload;
        },
        ...request.options,
      },
    ).result(),
  );
  return { payload: (captured.payload ?? mockState.lastParams) as CompletionsPayload, response };
});

const isToolEvent = (type: string) =>
  type === "toolcall_start" || type === "toolcall_delta" || type === "toolcall_end";

const collectEvents = Effect.fn("collectEvents")(function* (s: AssistantMessageEventStream) {
  const eventTypes: string[] = [];
  const toolEventsByContentIndex = new Map<number, string[]>();
  yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
    Stream.orDie,
    Stream.runForEach((event) =>
      Effect.sync(() => {
        eventTypes.push(event.type);
        if ("contentIndex" in event && isToolEvent(event.type)) {
          const events = toolEventsByContentIndex.get(event.contentIndex) ?? [];
          events.push(event.type);
          toolEventsByContentIndex.set(event.contentIndex, events);
        }
      }),
    ),
  );
  return { eventTypes, toolEventsByContentIndex };
});

const expectFinishedToolCall = (
  content: AssistantMessage["content"][number] | undefined,
  expected: { arguments: Record<string, unknown>; id: string; name: string },
) => {
  if (content?.type !== "toolCall") throw new Error("Expected toolCall content");
  expect({ arguments: content.arguments, id: content.id, name: content.name }).toEqual(expected);
  expect(content).not.toHaveProperty("streamIndex");
  expect(content).not.toHaveProperty("partialArgs");
};

const readTool: Tool = {
  description: "Read a file",
  name: "read",
  parameters: Type.Object({ path: Type.String() }),
};

const chunkUsage = (promptTokens: number, completionTokens: number) => ({
  completion_tokens: completionTokens,
  completion_tokens_details: { reasoning_tokens: 0 },
  prompt_tokens: promptTokens,
  prompt_tokens_details: { cached_tokens: 0 },
});

const resetMockStateBeforeEach = () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.chunks = undefined;
  });
};

const openaiCompletionsToolChoiceSupport = {
  chunkUsage,
  collectEvents,
  directCompletionsModel,
  expectFinishedToolCall,
  localOpenAICompletionsModel,
  mockState,
  optionalFieldTool,
  pingTool,
  promptModel,
  readTool,
  resetMockStateBeforeEach,
};

export default openaiCompletionsToolChoiceSupport;
