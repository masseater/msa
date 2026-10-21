import type aiTypes from "@msa/ai/index.types";
import type codemodeTypes from "@msa/codemode/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import interop from "../../utils/interop.ts";
import modelCallChecks from "./model-call-checks.ts";
import scriptText from "./script-text.ts";
import type toolTypes from "./tool.types.ts";

const { awaited, awaiting } = awaitingModule;
const { callbackPromise } = interop;
const { ERROR_PREVIEW_CHARS, truncateText } = scriptText;
const {
  MODEL_TYPES,
  checkClassifierContext,
  checkImagesContext,
  describeValue,
  modelReference,
  toModelInfo,
  toModelType,
  toProvider,
  withArticle,
} = modelCallChecks;

const MAX_CONCURRENT_MODEL_CALLS = 4;

interface ModelCallResult {
  stopReason: "stop" | "error" | "aborted";
  errorMessage?: string;
  usage?: aiTypes.Usage;
}

function createLimiter(limit: number): <T>(run: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return (run) =>
    Effect.runPromise(
      awaiting(function* () {
        if (active >= limit)
          yield* awaited(callbackPromise<void>((resolve) => waiting.push(resolve)));
        active++;
        try {
          return yield* awaited(run());
        } finally {
          active--;
          waiting.shift()?.();
        }
      }),
    );
}

interface ModelCallHost {
  models: toolTypes.CodemodeModelRuntime;
  toolCallId: string;
  calls: toolTypes.CodemodeNestedCall[];
  publish: () => void;
  addUsage: (usage: aiTypes.Usage) => void;
  addGeneratedImages: (count: number) => void;
}

type CallableType = "classifier" | "image";

function resolveTypedModel<TType extends CallableType>(
  models: toolTypes.CodemodeModelRuntime,
  model: unknown,
  name: string,
  type: TType,
): aiTypes.ModelTypeMap[TType] {
  const listHint = `List the ${type} models you can use with models.getAvailableOfType("${type}").`;
  const { provider, id } = modelReference(model, name, type, listHint);
  const resolved = models.getModelOfType(type, provider, id);
  if (resolved !== undefined) return resolved;
  const ref = `${provider}/${id}`;
  const actualType = [...MODEL_TYPES].find(
    (other) =>
      other !== type &&
      models.getModelOfType(other as aiTypes.ModelType, provider, id) !== undefined,
  );
  throw new Error(
    actualType !== undefined && actualType !== ""
      ? `"${ref}" is ${withArticle(actualType)} model, not ${withArticle(type)} model. ${listHint}`
      : `Unknown ${type} model "${ref}". ${listHint}`,
  );
}

function finishCall(
  record: toolTypes.CodemodeNestedCall,
  result: ModelCallResult,
  startedAt: number,
  addUsage: (usage: aiTypes.Usage) => void,
): void {
  record.durationMs = performance.now() - startedAt;
  record.status =
    result.stopReason === "stop" ? "ok" : result.stopReason === "aborted" ? "cancelled" : "error";
  if (result.errorMessage !== undefined && result.errorMessage !== "")
    record.error = truncateText(result.errorMessage, ERROR_PREVIEW_CHARS);
  if (result.usage !== undefined) {
    record.cost = result.usage.cost.total;
    addUsage(result.usage);
  }
}

function createModelCallRunner(host: ModelCallHost) {
  const limit = createLimiter(MAX_CONCURRENT_MODEL_CALLS);
  let callCount = 0;
  return <TType extends CallableType, TContext, TResult extends ModelCallResult>(
    name: string,
    type: TType,
    [model, context]: unknown[],
    checkContext: (context: unknown) => TContext,
    run: (resolved: aiTypes.ModelTypeMap[TType], context: TContext) => Promise<TResult>,
  ): Promise<TResult> =>
    Effect.runPromise(
      awaiting(function* () {
        const resolved = resolveTypedModel(host.models, model, name, type);
        const checked = checkContext(context);
        const record: toolTypes.CodemodeNestedCall = {
          args: `${resolved.provider}/${resolved.id}`,
          id: `${host.toolCallId}/${name}/${++callCount}`,
          name,
          status: "running",
        };
        host.calls.push(record);
        host.publish();
        const startedAt = performance.now();
        const result = yield* awaited(limit(() => run(resolved, checked)));
        finishCall(record, result, startedAt, host.addUsage);
        host.publish();
        return result;
      }),
    );
}

type Implementations = Record<string, codemodeTypes.CodemodeTool["execute"]>;

function modelCallImplementations(host: ModelCallHost): Implementations {
  const runModelCall = createModelCallRunner(host);
  const { models } = host;
  return {
    "models.classify": (args, { signal }) =>
      runModelCall(
        "models.classify",
        "classifier",
        args as unknown[],
        checkClassifierContext,
        (resolved, context) => models.classify(resolved, context, { signal }),
      ),
    "models.generateImages": (args, { signal }) =>
      runModelCall(
        "models.generateImages",
        "image",
        args as unknown[],
        checkImagesContext,
        (resolved, context) =>
          models.generateImages(resolved, context, { signal }).then((result) => {
            host.addGeneratedImages(result.output.filter((block) => block.type === "image").length);
            return result;
          }),
      ),
  };
}

function modelQueryImplementations(models: toolTypes.CodemodeModelRuntime): Implementations {
  return {
    "models.getAvailableOfType": (args, { signal }) => {
      const [type, provider] = args as unknown[];
      return models
        .getAvailableOfType(toModelType(type), toProvider(provider), { signal })
        .then((available) => available.map(toModelInfo));
    },
    "models.getModelOfType": (args) => {
      const [type, provider, id] = args as unknown[];
      if (typeof provider !== "string" || typeof id !== "string") {
        throw new Error(
          `models.getModelOfType(type, provider, id) expects three strings, got (${(args as unknown[]).map(describeValue).join(", ")}). The provider and the id are separate arguments, for example models.getModelOfType("classifier", "openrouter", "~typesafe/jev-latest").`,
        );
      }
      const model = models.getModelOfType(toModelType(type), provider, id);
      return model === undefined ? undefined : toModelInfo(model);
    },
    "models.getModelsOfType": (args) => {
      const [type, provider] = args as unknown[];
      return models.getModelsOfType(toModelType(type), toProvider(provider)).map(toModelInfo);
    },
  };
}

function createModelGlobals(
  models: toolTypes.CodemodeModelRuntime,
  toolCallId: string,
  calls: toolTypes.CodemodeNestedCall[],
  publish: () => void,
  addUsage: (usage: aiTypes.Usage) => void,
  addGeneratedImages: (count: number) => void,
): codemodeTypes.CodemodeTool[] {
  const host = { addGeneratedImages, addUsage, calls, models, publish, toolCallId };
  const implementations = {
    ...modelCallImplementations(host),
    ...modelQueryImplementations(models),
  };
  return Object.entries(implementations).map(([name, execute]) => ({
    execute,
    name,
    spread: true,
  }));
}

const modelGlobals = { createModelGlobals };

export default modelGlobals;
