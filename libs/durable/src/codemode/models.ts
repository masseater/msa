import type { AnyModel, ModelType, ModelTypeMap, Models, Usage } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { Type } from "typebox";

import define from "../harness/define.ts";
import type typesModule from "../harness/types.types.ts";
import modelInputs from "./model-inputs.ts";

const { checkClassifierContext, checkImagesContext, describeValue, isRecord } = modelInputs;
const { defineTool } = define;

const CODEMODE_INTERNAL_PREFIX = "msa.codemode.";
const CLASSIFY_TOOL = `${CODEMODE_INTERNAL_PREFIX}models.classify`;
const GENERATE_IMAGES_TOOL = `${CODEMODE_INTERNAL_PREFIX}models.generateImages`;

const MODEL_CALLS: Readonly<Record<string, string>> = {
  "models.classify": CLASSIFY_TOOL,
  "models.generateImages": GENERATE_IMAGES_TOOL,
};

const CATALOG_GLOBALS = [
  "models.getModelsOfType",
  "models.getAvailableOfType",
  "models.getModelOfType",
] as const;

const MAX_CONCURRENT_MODEL_CALLS = 4;

const MODEL_TYPES: ReadonlySet<string> = new Set<ModelType>(["chat", "image", "classifier"]);

const MODELS_DESCRIPTION = [
  "`models` (all functions return promises):",
  '- `models.getModelsOfType(type, provider?)`, `models.getAvailableOfType(type, provider?)` (configured auth only), `models.getModelOfType(type, provider, id)`: the catalog; `type` is "chat", "image", or "classifier".',
  '- `models.classify(model, { state: { ... }, images?: [{ type: "image", data, mimeType }], questions: { <id>: { type: "choice", instructions, criteria: { <label>: <meaning> } } | { type: "score", instructions, criteria: [<lowest level>, ..., <highest level>] } | { type: "bool", instructions, criteria: { true: <meaning>, false: <meaning> } } } })` resolves to `{ answers: { <id>: ... }, stopReason, errorMessage?, usage? }`.',
  '- `models.generateImages(model, { input: [{ type: "text", text: <prompt> }, ...optional { type: "image", data, mimeType }] })` resolves to `{ output: [image blocks], stopReason, errorMessage?, usage? }`; show each image with `image(block)`.',
  `At most ${MAX_CONCURRENT_MODEL_CALLS} classify/generateImages calls run at once; more wait.`,
].join("\n");

function withArticle(word: string): string {
  return `${/^[aeiou]/u.test(word) ? "an" : "a"} ${word}`;
}

function toModelType(value: unknown): ModelType {
  if (typeof value === "string" && MODEL_TYPES.has(value)) return value as ModelType;
  throw new Error(
    `Unknown model type ${JSON.stringify(value)}. Use "chat", "image", or "classifier".`,
  );
}

function toProvider(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("provider must be a string");
  return value;
}

function toModelInfo(model: AnyModel): JsonValue {
  const info: Record<string, unknown> = { ...model };
  delete info["headers"];
  return JSON.parse(JSON.stringify(info)) as JsonValue;
}

const catalogCall = Effect.fnUntraced(function* (
  name: string,
  args: unknown,
  models: Models,
  context: Context,
) {
  const list = Array.isArray(args) ? args : [];
  const [type, provider, id] = list;
  if (name === "models.getModelsOfType")
    return models.getModelsOfType(toModelType(type), toProvider(provider)).map(toModelInfo);
  if (name === "models.getAvailableOfType") {
    const modelType = toModelType(type);
    const providerName = toProvider(provider);
    const available = yield* Effect.promise(() =>
      models.getAvailableOfType(modelType, providerName, {
        ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
      }),
    );
    return available.map(toModelInfo);
  }
  if (typeof provider !== "string" || typeof id !== "string") {
    throw new Error(
      `models.getModelOfType(type, provider, id) expects three strings, got (${list.map(describeValue).join(", ")}). The provider and the id are separate arguments, for example models.getModelOfType("classifier", "typesafe", "jev-latest").`,
    );
  }
  const model = models.getModelOfType(toModelType(type), provider, id);
  return model === undefined ? undefined : toModelInfo(model);
});

function resolveModel<TType extends "classifier" | "image">(
  name: string,
  type: TType,
  model: unknown,
  models: Models,
): ModelTypeMap[TType] {
  const listHint = `List the ${type} models you can use with models.getAvailableOfType("${type}").`;
  if (
    !isRecord(model) ||
    typeof model["provider"] !== "string" ||
    typeof model["id"] !== "string"
  ) {
    const undefinedHint =
      model === undefined || model === null
        ? " models.getModelOfType() returns undefined for an unknown provider or id."
        : "";
    throw new Error(
      `${name}() expects ${withArticle(type)} model as its first argument, got ${describeValue(model)}.${undefinedHint} ${listHint}`,
    );
  }
  const { provider, id } = model;
  const resolved = models.getModelOfType(type, provider, id);
  if (resolved !== undefined) return resolved;
  const actualType = [...MODEL_TYPES].find(
    (other) =>
      other !== type && models.getModelOfType(other as ModelType, provider, id) !== undefined,
  );
  throw new Error(
    actualType === undefined
      ? `Unknown ${type} model "${provider}/${id}". ${listHint}`
      : `"${provider}/${id}" is ${withArticle(actualType)} model, not ${withArticle(type)} model. ${listHint}`,
  );
}

const ModelCallParameters = Type.Object({ context: Type.Unknown(), model: Type.Unknown() });

function modelResult(
  label: string,
  result: { stopReason: string; errorMessage?: string; usage?: Usage },
  value: unknown,
) {
  const ok = result.stopReason === "stop";
  return {
    output: [
      {
        text: ok ? `${label} done` : `${label} ${result.stopReason}: ${result.errorMessage ?? ""}`,
        type: "text" as const,
      },
    ],
    structuredOutput: JSON.parse(JSON.stringify(value)) as JsonValue,
    ...(ok ? {} : { isError: true }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

function createModelTools(): typesModule.ToolRegistration[] {
  const classify = defineTool({
    callers: ["tools"],
    description: "models.classify() of code mode scripts.",
    execute: (args, api, context) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const model = resolveModel("models.classify", "classifier", args.model, api.models);
          const checked = checkClassifierContext(args.context);
          const result = yield* Effect.promise(() =>
            api.models.classify(model, checked, {
              ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
            }),
          );
          return modelResult(`classify ${model.provider}/${model.id}`, result, result);
        }),
      ),
    name: CLASSIFY_TOOL,
    parameters: ModelCallParameters,
    structuredOutputSchema: Type.Unknown(),
  });
  const generateImages = defineTool({
    callers: ["tools"],
    description: "models.generateImages() of code mode scripts.",
    execute: (args, api, context) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const model = resolveModel("models.generateImages", "image", args.model, api.models);
          const checked = checkImagesContext(args.context);
          const result = yield* Effect.promise(() =>
            api.models.generateImages(model, checked, {
              ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
            }),
          );
          return modelResult(`generateImages ${model.provider}/${model.id}`, result, result);
        }),
      ),
    name: GENERATE_IMAGES_TOOL,
    parameters: ModelCallParameters,
    structuredOutputSchema: Type.Unknown(),
  });
  return [
    classify as unknown as typesModule.ToolRegistration,
    generateImages as unknown as typesModule.ToolRegistration,
  ];
}

const modelsModule = {
  CATALOG_GLOBALS,
  CLASSIFY_TOOL,
  CODEMODE_INTERNAL_PREFIX,
  GENERATE_IMAGES_TOOL,
  MAX_CONCURRENT_MODEL_CALLS,
  MODELS_DESCRIPTION,
  MODEL_CALLS,
  catalogCall,
  createModelTools,
};

export default modelsModule;
