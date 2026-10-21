import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, FileSystem, ManagedRuntime, Option } from "effect";
import { Type } from "typebox";
import { inject } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type compatTypes from "../src/compat.types.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import jsonCodec from "./json-codec.ts";
import modelChoice from "./model-choice.ts";

const { completeSimple, getEnvApiKey } = compatModule;
const { currentTimeMillis } = clock;

const { encodeJsonPretty } = jsonCodec;
const { chooseModel, modelsWhere } = modelChoice;

const runtime = ManagedRuntime.make(NodeServices.layer);
const storedApiKeys = inject("storedApiKeys");

interface HandoffTarget {
  readonly label: string;
  readonly model: typesModule.Model<typesModule.Api>;
}

const doubleNumberSchema = Type.Object({
  value: Type.Number({ description: "A number to double" }),
});

const doubleNumberTool: typesModule.Tool<typeof doubleNumberSchema> = {
  description: "Doubles a number and returns the result",
  name: "double_number",
  parameters: doubleNumberSchema,
};

const cheapestPerApi = (provider: compatTypes.BuiltinProvider): HandoffTarget[] =>
  [...new Set(modelsWhere(provider, () => true).map((model) => model.api))].map((api) => {
    const model = chooseModel(provider, `${api}`, (candidate) => candidate.api === api);
    return { label: `${provider}-${api}-${model.id}`, model };
  });

const directCompletions = (): HandoffTarget => {
  const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
  return {
    label: `openai-completions-${baseModel.id}`,
    model: { ...baseModel, api: "openai-completions" },
  };
};

const handoffTargets: HandoffTarget[] = [
  ...cheapestPerApi("anthropic-api"),
  directCompletions(),
  ...cheapestPerApi("openai"),
  ...cheapestPerApi("openai-codex"),
  ...cheapestPerApi("opencode"),
  ...cheapestPerApi("opencode-go"),
];

const apiKeyFor = (model: typesModule.Model<typesModule.Api>): string | undefined => {
  const stored = storedApiKeys[model.provider];
  return stored !== undefined && stored !== "" ? stored : getEnvApiKey(model.provider);
};

const dumpFailure = (
  label: string,
  error: string,
  payload: unknown,
  messages: typesModule.Message[],
) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const filename = `/tmp/msa-handoff-${label}-${currentTimeMillis()}.json`;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        filename,
        yield* encodeJsonPretty({ error, label, messages, payload }),
      );
      yield* Console.log(`Wrote failure payload to ${filename}`);
    }).pipe(Effect.orDie),
  );

const completeOrReport = Effect.fn("completeOrReport")(function* (
  target: HandoffTarget,
  label: string,
  messages: typesModule.Message[],
  systemPrompt: string,
) {
  const captured: { payload?: unknown } = {};
  const response: typesModule.AssistantMessage = yield* Effect.promise(() =>
    completeSimple(
      target.model,
      { messages, systemPrompt, tools: [doubleNumberTool] },
      {
        apiKey: apiKeyFor(target.model),
        onPayload: (payload) => {
          captured.payload = payload;
        },
        ...(target.model.reasoning ? { reasoning: "high" as const } : {}),
      },
    ),
  );
  if (response.stopReason !== "error") return Option.some(response);
  const error = response.errorMessage ?? "Unknown error";
  yield* Console.log(`  [${label}] ${error}`);
  yield* Effect.promise(() => dumpFailure(label, error, captured.payload, messages));
  return Option.none<typesModule.AssistantMessage>();
});

const generateFixture = Effect.fn("generateFixture")(function* (target: HandoffTarget) {
  const userMessage: typesModule.Message = {
    content: "Please double the number 21 using the double_number tool.",
    role: "user",
    timestamp: currentTimeMillis(),
  };
  const first = yield* completeOrReport(
    target,
    `${target.label}-initial`,
    [userMessage],
    "You are a helpful assistant. Use the provided tool to complete the task.",
  );
  if (Option.isNone(first)) return Option.none<typesModule.Message[]>();
  const toolCall = first.value.content.find((content) => content.type === "toolCall");
  if (toolCall?.type !== "toolCall") return Option.none<typesModule.Message[]>();
  const history: typesModule.Message[] = [
    userMessage,
    first.value,
    {
      content: [{ text: "42", type: "text" }],
      isError: false,
      role: "toolResult",
      timestamp: currentTimeMillis(),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    },
  ];
  const final = yield* completeOrReport(
    target,
    `${target.label}-final`,
    history,
    "You are a helpful assistant.",
  );
  return Option.map(final, (response) => [...history, response]);
});

const crossProviderHandoffSupport = {
  apiKeyFor,
  completeOrReport,
  generateFixture,
  handoffTargets,
};

export default crossProviderHandoffSupport;
