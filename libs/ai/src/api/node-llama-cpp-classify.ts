import { Clock, Deferred, Effect, Option, Semaphore } from "effect";
import type { Token } from "node-llama-cpp";

import type typesModule from "../types.types.ts";
import errorBody from "../utils/error-body.ts";
import DownloadDisabledError from "./download-disabled-error.ts";
import type llamaCppClassifyTypes from "./llama-cpp-classify.types.ts";
import llamaCppPrompt from "./llama-cpp-prompt.ts";
import llamaCppReadout from "./llama-cpp-readout.ts";
import type nodeLlamaCppClassifyTypes from "./node-llama-cpp-classify.types.ts";
import nodeLlamaCppEvaluate from "./node-llama-cpp-evaluate.ts";

const { SYSTEM_PROMPT, renderQuestion } = llamaCppPrompt;
const { answerFromProbabilities, labelProbabilities } = llamaCppReadout;
const { formatProviderError, normalizeProviderError } = errorBody;

const { LABEL, nextTokenProbabilities, sharedPrefixLength } = nodeLlamaCppEvaluate;

type LoadedModel = nodeLlamaCppClassifyTypes.LoadedModel;

type Config = nodeLlamaCppClassifyTypes.LocalClassifierConfig;

type Bindings = typeof import("node-llama-cpp");

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface Load {
  readonly loaded: Deferred.Deferred<LoadedModel, string>;
  readonly downloading: Deferred.Deferred<void>;
}

const loads = new Map<string, Load>();

const resolveFile = (
  bindings: Bindings,
  config: Config,
  uri: string,
  downloading: Deferred.Deferred<void>,
) =>
  Effect.gen(function* () {
    const { resolveModelFile } = bindings;
    const options = {
      cli: false,
      directory: config.directory,
      ...(config.endpoints === undefined ? {} : { endpoints: config.endpoints }),
    };
    const existing = yield* Effect.tryPromise(() =>
      resolveModelFile(uri, { ...options, download: false }),
    ).pipe(Effect.option);
    if (Option.isSome(existing)) return existing.value;
    if (config.download === false)
      return yield* DownloadDisabledError.make({
        cause: new Error(`${uri} is not in ${config.directory} and downloads are disabled`),
      });
    yield* Deferred.succeed(downloading, undefined);
    return yield* Effect.tryPromise(() => resolveModelFile(uri, options));
  });

const loadModel = Effect.fn("loadModel")(function* (
  config: Config,
  uri: string,
  contextSize: number,
  downloading: Deferred.Deferred<void>,
) {
  const bindings = yield* Effect.tryPromise(
    (): Promise<Bindings> => config.loadBindings?.() ?? import("node-llama-cpp"),
  );
  const path = yield* resolveFile(bindings, config, uri, downloading);
  const llama = yield* Effect.tryPromise(() =>
    bindings.getLlama({
      build: "never",
      logLevel: bindings.LlamaLogLevel.error,
      progressLogs: false,
    }),
  );
  const model = yield* Effect.tryPromise(() => llama.loadModel({ modelPath: path }));
  const context = yield* Effect.tryPromise(() =>
    model.createContext({ contextSize, sequences: 1 }),
  );
  const loaded: LoadedModel = {
    chatWrapper: bindings.resolveChatWrapper(model),
    labelTokens: new Map(),
    lock: yield* Semaphore.make(1),
    model,
    sequence: context.getSequence(),
  };
  return loaded;
});

function startLoad(config: Config, uri: string, contextSize: number): Load {
  const key = `${config.directory}\u0000${uri}`;
  const cached = loads.get(key);
  if (cached !== undefined) return cached;
  const load: Load = {
    downloading: Deferred.makeUnsafe<void>(),
    loaded: Deferred.makeUnsafe<LoadedModel, string>(),
  };
  loads.set(key, load);
  Effect.runFork(
    loadModel(config, uri, contextSize, load.downloading).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.sync(() => loads.delete(key)).pipe(
            Effect.andThen(Deferred.fail(load.loaded, errorMessage(error.cause))),
          ),
        onSuccess: (model) => Deferred.succeed(load.loaded, model),
      }),
    ),
  );
  return load;
}

const loadedNow = Effect.fn("loadedNow")(function* (load: Load, uri: string) {
  if (!(yield* Deferred.isDone(load.loaded)))
    return yield* Effect.die(new Error(`${LABEL} has not loaded ${uri} yet`));
  return yield* Deferred.await(load.loaded).pipe(
    Effect.mapError((message) => new Error(message)),
    Effect.orDie,
  );
});

const prepareModel = Effect.fn("prepareModel")(function* (
  config: Config,
  model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
) {
  const load = startLoad(config, model.baseUrl, model.contextWindow);
  yield* Deferred.await(load.loaded).pipe(
    Effect.mapError((message) => new Error(message)),
    Effect.orDie,
  );
  const preparation: typesModule.ClassifierPreparation = {
    fetched: yield* Deferred.isDone(load.downloading),
  };
  return preparation;
});

function labelToken(loaded: LoadedModel, label: string): Token | undefined {
  if (loaded.labelTokens.has(label)) return loaded.labelTokens.get(label);
  const newline = loaded.model.tokenize("\n");
  const withLabel = loaded.model.tokenize(`\n${label}`);
  const alone = loaded.model.tokenize(label);
  const token =
    withLabel.length === newline.length + 1 && newline.every((id, index) => withLabel[index] === id)
      ? withLabel[newline.length]
      : alone.length === 1
        ? alone[0]
        : undefined;
  loaded.labelTokens.set(label, token);
  return token;
}

function promptTokens(loaded: LoadedModel, content: string): Token[] {
  const { contextText } = loaded.chatWrapper.generateContextState({
    chatHistory: [
      { text: SYSTEM_PROMPT, type: "system" },
      { text: content, type: "user" },
      { response: [], type: "model" },
    ],
  });
  return contextText.tokenize(loaded.model.tokenizer);
}

interface QuestionRequest {
  readonly rendered: llamaCppClassifyTypes.LabeledQuestion;
  readonly prompt: Token[];
  readonly shared: number;
  readonly id: string;
  readonly question: typesModule.ClassifierQuestion;
  readonly temperature: number;
}

const classifyQuestion = Effect.fn("classifyQuestion")(function* (
  loaded: LoadedModel,
  { rendered, prompt, shared, id, question, temperature }: QuestionRequest,
) {
  const tokens = rendered.labels.map((label) => labelToken(loaded, label));
  const missing = rendered.labels.filter((_label, index) => tokens[index] === undefined);
  if (missing.length > 0)
    return yield* Effect.die(
      new Error(`${LABEL} cannot read labels ${missing.join(", ")} as single tokens`),
    );
  const probabilities = yield* nextTokenProbabilities(loaded, prompt, shared).pipe(Effect.orDie);
  const logprobs = tokens.map((token) => Math.log(probabilities.get(token!) ?? 0));
  if (logprobs.every((logprob) => logprob === -Infinity))
    return yield* Effect.die(
      new Error(`${LABEL} gave no probability to any answer label for ${id}`),
    );
  return answerFromProbabilities(
    question,
    rendered.keys,
    labelProbabilities(logprobs, temperature),
  );
});

const classifyAll = Effect.fn("classifyAll")(function* (
  config: Config,
  model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  context: typesModule.ClassifierContext,
  options: typesModule.ClassifierOptions | undefined,
) {
  if (context.images?.length !== undefined && context.images.length > 0)
    return yield* Effect.die(new Error(`${LABEL} classification does not support image input`));
  const temperature = options?.temperature ?? 1;
  if (!(temperature > 0) || !Number.isFinite(temperature))
    return yield* Effect.die(
      new Error(`Temperature must be a positive number, got ${temperature}`),
    );
  const questions = Object.entries(context.questions).map(([id, question]) => ({
    id,
    question,
    rendered: renderQuestion(context, id),
  }));
  const loaded = yield* loadedNow(
    startLoad(config, model.baseUrl, model.contextWindow),
    model.baseUrl,
  );
  const prompted = questions.map(({ id, question, rendered }) => ({
    id,
    prompt: promptTokens(loaded, rendered.content),
    question,
    rendered,
  }));
  const shared = sharedPrefixLength(prompted.map(({ prompt }) => prompt));
  const answers: Array<[string, typesModule.ClassifierAnswer]> = [];
  for (const entry of prompted)
    answers.push([entry.id, yield* classifyQuestion(loaded, { ...entry, shared, temperature })]);
  return Object.fromEntries(answers);
});

const untilAborted = (signal: AbortSignal | undefined) =>
  signal === undefined
    ? Effect.never
    : Effect.callback<never>((resume) => {
        const abort = () => resume(Effect.die(new Error("Request was aborted")));
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", abort));
      });

function nodeLlamaCppClassifier(config: Config): Required<typesModule.ProviderClassifier> {
  return {
    classify: (model, context, options) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const output: typesModule.ClassifierResult = {
            answers: {},
            api: model.api,
            model: model.id,
            provider: model.provider,
            stopReason: "stop",
            timestamp: yield* Clock.currentTimeMillis,
          };
          return yield* Effect.raceFirst(
            classifyAll(config, model, context, options),
            untilAborted(options?.signal),
          ).pipe(
            Effect.map((answers): typesModule.ClassifierResult => ({ ...output, answers })),
            Effect.catchDefect((error) =>
              Effect.succeed<typesModule.ClassifierResult>({
                ...output,
                errorMessage: formatProviderError(normalizeProviderError(error), `${LABEL} error`),
                stopReason: options?.signal?.aborted === true ? "aborted" : "error",
              }),
            ),
          );
        }),
      ),
    prepare: (model) => Effect.runPromise(prepareModel(config, model)),
  };
}

const nodeLlamaCppClassify = {
  nodeLlamaCppClassifier,
};

export default nodeLlamaCppClassify;
