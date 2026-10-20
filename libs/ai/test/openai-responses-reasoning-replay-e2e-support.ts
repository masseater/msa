import { Clock, Console, Effect } from "effect";
import { Type } from "typebox";

import { complete } from "../src/compat.ts";
import type { Api, AssistantMessage, Message, Model, StreamOptions, Tool } from "../src/types.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;
type ResponsesInputItem = { readonly id?: unknown; readonly type?: unknown };

const doubleNumberSchema = Type.Object({
  value: Type.Number({ description: "A number to double" }),
});

const doubleNumberTool: Tool<typeof doubleNumberSchema> = {
  description: "Doubles a number and returns the result",
  name: "double_number",
  parameters: doubleNumberSchema,
};

const askToDouble = Effect.fn("askToDouble")(function* <TApi extends Api>(
  model: Model<TApi>,
  options: StreamOptionsWithExtras,
  systemPrompt = "You are a helpful assistant. Always use the tool when asked.",
) {
  const userMessage: Message = {
    content: "Use the double_number tool to double 21.",
    role: "user",
    timestamp: yield* Clock.currentTimeMillis,
  };
  const assistantResponse: AssistantMessage = yield* Effect.promise(() =>
    complete(model, { messages: [userMessage], systemPrompt, tools: [doubleNumberTool] }, options),
  );
  return { assistantResponse, userMessage };
});

const answerAfterToolResult = Effect.fn("answerAfterToolResult")(function* <TApi extends Api>(
  history: { readonly assistantResponse: AssistantMessage; readonly userMessage: Message },
  model: Model<TApi>,
  options: StreamOptionsWithExtras,
) {
  const toolCall = history.assistantResponse.content.find((block) => block.type === "toolCall");
  if (toolCall?.type !== "toolCall") throw new Error("The first model did not use the tool");
  const timestamp = yield* Clock.currentTimeMillis;
  const captured: { payload?: unknown } = {};
  const response = yield* Effect.promise(() =>
    complete(
      model,
      {
        messages: [
          history.userMessage,
          history.assistantResponse,
          {
            content: [{ text: "42", type: "text" }],
            isError: false,
            role: "toolResult",
            timestamp,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          },
          { content: "What was the result? Answer with just the number.", role: "user", timestamp },
        ],
        systemPrompt: "You are a helpful assistant. Answer concisely.",
        tools: [doubleNumberTool],
      },
      {
        ...options,
        onPayload: (payload) => {
          captured.payload = payload;
        },
      },
    ),
  );
  const input = ((captured.payload as { input?: ResponsesInputItem[] } | undefined)?.input ??
    []) as ResponsesInputItem[];
  yield* Console.log(
    `Replayed ${input.filter((item) => item.type === "function_call").length} function calls and ${input.filter((item) => item.type === "reasoning").length} reasoning items`,
  );
  return response;
});

const textOf = (message: AssistantMessage) =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

const openaiResponsesReasoningReplayE2eSupport = {
  answerAfterToolResult,
  askToDouble,
  doubleNumberTool,
  textOf,
};

export default openaiResponsesReasoningReplayE2eSupport;
