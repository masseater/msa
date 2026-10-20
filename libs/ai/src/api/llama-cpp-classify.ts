import { Clock, Effect } from "effect";

import type typesModule from "../types.types.ts";
import errorBody from "../utils/error-body.ts";
import modelCallModule from "../utils/model-call.ts";
import llamaCppHttp from "./llama-cpp-http.ts";
import type llamaCppHttpTypes from "./llama-cpp-http.types.ts";
import llamaCppPrompt from "./llama-cpp-prompt.ts";
import llamaCppReadout from "./llama-cpp-readout.ts";
import llamaCppTokens from "./llama-cpp-tokens.ts";

const { labelTokens } = llamaCppTokens;

const {
  MIN_READOUT_DEPTH,
  READOUT_DEPTH_PER_LABEL,
  READOUT_ESCALATION,
  UNDERFLOW_LOGPROB,
  answerFromProbabilities,
  labelProbabilities,
  peakConfidence,
} = llamaCppReadout;

const { isRecord, llamaServerRoot, post } = llamaCppHttp;

const { LABEL, SYSTEM_PROMPT, renderQuestion } = llamaCppPrompt;

const { modelCall } = modelCallModule;
const { formatProviderError, normalizeProviderError } = errorBody;

const renderPrompt = Effect.fn("renderPrompt")(function* (
  request: llamaCppHttpTypes.RequestContext,
  content: string,
) {
  const body = yield* post(request, {
    body: {
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { content: SYSTEM_PROMPT, role: "system" },
        { content, role: "user" },
      ],
      model: request.model.id,
    },
    observe: false,
    path: "/apply-template",
  });
  if (!isRecord(body) || typeof body["prompt"] !== "string")
    return yield* Effect.die(new Error(`${LABEL} did not return a prompt`));
  return body["prompt"].endsWith("<think>") ? `${body["prompt"]}</think>` : body["prompt"];
});

function readLogprobs(body: unknown, tokens: readonly number[]): Array<number | undefined> {
  const first =
    isRecord(body) && Array.isArray(body["completion_probabilities"])
      ? body["completion_probabilities"][0]
      : undefined;
  if (!isRecord(first) || !Array.isArray(first["top_logprobs"])) {
    throw new Error(`${LABEL} did not return token probabilities`);
  }
  const byToken = new Map<number, number>();
  for (const entry of first["top_logprobs"]) {
    if (
      isRecord(entry) &&
      typeof entry["id"] === "number" &&
      typeof entry["logprob"] === "number"
    ) {
      byToken.set(entry["id"], entry["logprob"]);
    }
  }
  return tokens.map((token) => byToken.get(token));
}

interface LogprobRequest {
  readonly prompt: string;
  readonly tokens: readonly number[];
  readonly depth: number;
}

const nextTokenLogprobs = (
  request: llamaCppHttpTypes.RequestContext,
  { prompt, tokens, depth }: LogprobRequest,
): Effect.Effect<Array<number | undefined>> =>
  post(request, {
    body: {
      cache_prompt: true,
      model: request.model.id,
      n_predict: 1,
      n_probs: depth,
      post_sampling_probs: false,
      prompt,
      temperature: 0,
    },
    observe: true,
    path: "/completion",
  }).pipe(Effect.flatMap((body) => Effect.sync(() => readLogprobs(body, tokens))));

const readoutUntilRanked = Effect.fn("readoutUntilRanked")(function* (
  request: llamaCppHttpTypes.RequestContext,
  prompt: string,
  tokens: readonly number[],
  depths: readonly number[],
) {
  let logprobs: Array<number | undefined> = [];
  for (const depth of depths) {
    logprobs = yield* nextTokenLogprobs(request, { depth, prompt, tokens });
    if (logprobs.every((logprob) => logprob !== undefined)) break;
  }
  return logprobs;
});

interface QuestionRequest {
  readonly context: typesModule.ClassifierContext;
  readonly id: string;
  readonly question: typesModule.ClassifierQuestion;
  readonly temperature: number;
}

const classifyQuestion = Effect.fn("classifyQuestion")(function* (
  request: llamaCppHttpTypes.RequestContext,
  { context, id, question, temperature }: QuestionRequest,
) {
  const rendered = renderQuestion(context, id);
  const [tokens, prompt] = yield* Effect.all(
    [labelTokens(request, rendered.labels), renderPrompt(request, rendered.content)],
    { concurrency: "unbounded" },
  );
  const depths = [
    Math.max(MIN_READOUT_DEPTH, READOUT_DEPTH_PER_LABEL * tokens.length),
    ...READOUT_ESCALATION,
  ];
  const logprobs = yield* readoutUntilRanked(request, prompt, tokens, depths);
  const missing = rendered.labels.filter((_label, index) => logprobs[index] === undefined);
  if (missing.length > 0) {
    return yield* Effect.die(
      new Error(
        `${LABEL} did not rank labels ${missing.join(", ")} for ${id} within the top ${depths.at(-1)} tokens`,
      ),
    );
  }
  const values = logprobs as number[];
  if (values.every((logprob) => logprob <= UNDERFLOW_LOGPROB)) {
    return yield* Effect.die(
      new Error(`${request.model.id} gave no probability to any answer label for ${id}`),
    );
  }
  return answerFromProbabilities(question, rendered.keys, labelProbabilities(values, temperature));
});

const classifyAll = Effect.fn("classifyAll")(function* (
  model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  context: typesModule.ClassifierContext,
  options: typesModule.ClassifierOptions | undefined,
) {
  if (model.api !== "llama-cpp-classify")
    return yield* Effect.die(new Error(`Unsupported classifier API: ${model.api}`));
  if (context.images?.length !== undefined && context.images?.length > 0)
    return yield* Effect.die(new Error(`${LABEL} classification does not support image input`));
  const temperature = options?.temperature ?? 1;
  if (!(temperature > 0) || !Number.isFinite(temperature)) {
    return yield* Effect.die(
      new Error(`Temperature must be a positive number, got ${temperature}`),
    );
  }
  for (const id of Object.keys(context.questions)) renderQuestion(context, id);
  const request: llamaCppHttpTypes.RequestContext = {
    model,
    options,
    root: llamaServerRoot(model.baseUrl),
  };
  const answers: Array<[string, typesModule.ClassifierAnswer]> = [];
  for (const [id, question] of Object.entries(context.questions)) {
    answers.push([id, yield* classifyQuestion(request, { context, id, question, temperature })]);
  }
  return Object.fromEntries(answers);
});

const classify = modelCall<
  Parameters<typesModule.ClassifierFunction<typesModule.ClassifierOptions>>[0],
  Parameters<typesModule.ClassifierFunction<typesModule.ClassifierOptions>>[1],
  NonNullable<Parameters<typesModule.ClassifierFunction<typesModule.ClassifierOptions>>[2]>,
  ReturnType<typesModule.ClassifierFunction<typesModule.ClassifierOptions>>
>((model, context, options) =>
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
      return yield* classifyAll(model, context, options).pipe(
        Effect.map((answers): typesModule.ClassifierResult => {
          output.answers = answers;
          return output;
        }),
        Effect.catchDefect((error) =>
          Effect.sync((): typesModule.ClassifierResult => {
            output.answers = {};
            output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
            output.errorMessage = formatProviderError(
              normalizeProviderError(error),
              `${LABEL} error`,
            );
            return output;
          }),
        ),
      );
    }),
  ),
);

const llamaCppClassify = {
  answerFromProbabilities,
  classify,
  labelProbabilities,
  llamaServerRoot,
  peakConfidence,
  renderQuestion,
};

export default llamaCppClassify;
