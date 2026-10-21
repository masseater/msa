import { Clock, Effect, Function } from "effect";

import type typesModule from "../types.types.ts";
import errorBody from "../utils/error-body.ts";
import classifierShared from "./classifier-shared.ts";
import type systemOneSharedTypes from "./system-one-shared.types.ts";

const { classifierRequest, isRecord, parseClassifierUsage, requiredNumber } = classifierShared;
const { formatProviderError, normalizeProviderError } = errorBody;

function probabilities(label: string, value: unknown, id: string): Record<string, number> {
  if (!isRecord(value)) throw new Error(`${label} returned invalid probabilities for ${id}`);
  return Object.fromEntries(
    Object.entries(value).map(([key, probability]) => [
      key,
      requiredNumber(label, probability, `probability for ${id}.${key}`),
    ]),
  );
}

function parseAnswers(
  label: string,
  value: unknown,
  context: typesModule.ClassifierContext,
): Record<string, typesModule.ClassifierAnswer> {
  if (!isRecord(value)) throw new Error(`${label} returned an unexpected response`);
  const answers: Array<[string, typesModule.ClassifierAnswer]> = [];
  for (const [id, question] of Object.entries(context.questions)) {
    const answer = value[id];
    if (!isRecord(answer)) throw new Error(`${label} did not return an answer for ${id}`);
    if (question.type === "choice") {
      if (answer["type"] !== "choice" || typeof answer["choice"] !== "string") {
        throw new Error(`${label} did not return a choice answer for ${id}`);
      }
      answers.push([
        id,
        {
          choice: answer["choice"],
          confidence: requiredNumber(label, answer["confidence"], `confidence for ${id}`),
          probabilities: probabilities(label, answer["probabilities"], id),
          type: "choice",
        },
      ]);
    } else if (question.type === "score") {
      if (answer["type"] !== "score")
        throw new Error(`${label} did not return a score answer for ${id}`);
      answers.push([
        id,
        {
          confidence: requiredNumber(label, answer["confidence"], `confidence for ${id}`),
          score: requiredNumber(label, answer["score"], `score for ${id}`),
          type: "score",
        },
      ]);
    } else {
      if (answer["type"] !== "noul")
        throw new Error(`${label} did not return a bool answer for ${id}`);
      answers.push([
        id,
        {
          probability: requiredNumber(label, answer["noul"], `probability for ${id}`),
          type: "bool",
        },
      ]);
    }
  }
  return Object.fromEntries(answers);
}

function wireRequest(
  context: typesModule.ClassifierContext,
): systemOneSharedTypes.SystemOneWireRequest {
  return {
    questions: Object.fromEntries(
      Object.entries(context.questions).map(([id, question]) => [
        id,
        question.type === "bool" ? { ...question, type: "noul" } : question,
      ]),
    ),
    state: context.state,
  };
}

const requestSystemOne = Effect.fn("requestSystemOne")(function* (
  transport: systemOneSharedTypes.SystemOneTransport,
  model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  context: typesModule.ClassifierContext,
  options: typesModule.ClassifierOptions | undefined,
  output: typesModule.ClassifierResult,
) {
  if (model.api !== transport.api)
    return yield* Effect.die(new Error(`Unsupported classifier API: ${model.api}`));
  if (context.images?.length !== undefined && context.images?.length > 0)
    return yield* Effect.die(new Error(`${transport.label} does not support image input`));
  const body = yield* classifierRequest({
    body: transport.payload(model, wireRequest(context)),
    label: transport.label,
    model,
    options,
    url: transport.url(model),
  });
  const result = transport.output(body);
  const usage = parseClassifierUsage(result["usage"], model);
  if (usage !== undefined) output.usage = usage;
  output.answers = parseAnswers(transport.label, result["answers"], context);
  return output;
});

const classifySystemOne: {
  (
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
    context: typesModule.ClassifierContext,
    options: typesModule.ClassifierOptions | undefined,
  ): (transport: systemOneSharedTypes.SystemOneTransport) => Promise<typesModule.ClassifierResult>;
  (
    transport: systemOneSharedTypes.SystemOneTransport,
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
    context: typesModule.ClassifierContext,
    options: typesModule.ClassifierOptions | undefined,
  ): Promise<typesModule.ClassifierResult>;
} = Function.dual(
  4,
  function (
    transport: systemOneSharedTypes.SystemOneTransport,
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
    context: typesModule.ClassifierContext,
    options: typesModule.ClassifierOptions | undefined,
  ): Promise<typesModule.ClassifierResult> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const output: typesModule.ClassifierResult = {
          answers: {},
          api: model.api,
          model: model.id,
          provider: model.provider,
          stopReason: "stop",
          timestamp: yield* Clock.currentTimeMillis,
        };
        return yield* requestSystemOne(transport, model, context, options, output).pipe(
          Effect.catchDefect((error) =>
            Effect.sync((): typesModule.ClassifierResult => {
              output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
              output.errorMessage = formatProviderError(
                normalizeProviderError(error),
                `${transport.label} error`,
              );
              return output;
            }),
          ),
        );
      }),
    );
  },
);

const systemOneShared = {
  classifySystemOne,
};

export default systemOneShared;
