import { Clock, Effect, Function } from "effect";

import type {
  ClassifierAnswer,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierOptions,
  ClassifierResult,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import {
  isRecord,
  parseClassifierUsage,
  classifierRequest,
  requiredNumber,
} from "./classifier-shared.ts";

export interface SystemOneWireRequest {
  state: ClassifierContext["state"];
  questions: Record<string, unknown>;
}

export interface SystemOneTransport {
  api: ClassifierApi;
  label: string;
  url(model: ClassifierModel<ClassifierApi>): URL;
  payload(model: ClassifierModel<ClassifierApi>, request: SystemOneWireRequest): unknown;
  output(body: unknown): Record<string, unknown>;
}

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
  context: ClassifierContext,
): Record<string, ClassifierAnswer> {
  if (!isRecord(value)) throw new Error(`${label} returned an unexpected response`);
  const answers: Array<[string, ClassifierAnswer]> = [];
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
          type: "choice",
          choice: answer["choice"],
          probabilities: probabilities(label, answer["probabilities"], id),
          confidence: requiredNumber(label, answer["confidence"], `confidence for ${id}`),
        },
      ]);
    } else if (question.type === "score") {
      if (answer["type"] !== "score")
        throw new Error(`${label} did not return a score answer for ${id}`);
      answers.push([
        id,
        {
          type: "score",
          score: requiredNumber(label, answer["score"], `score for ${id}`),
          confidence: requiredNumber(label, answer["confidence"], `confidence for ${id}`),
        },
      ]);
    } else {
      if (answer["type"] !== "noul")
        throw new Error(`${label} did not return a bool answer for ${id}`);
      answers.push([
        id,
        {
          type: "bool",
          probability: requiredNumber(label, answer["noul"], `probability for ${id}`),
        },
      ]);
    }
  }
  return Object.fromEntries(answers);
}

function wireRequest(context: ClassifierContext): SystemOneWireRequest {
  return {
    state: context.state,
    questions: Object.fromEntries(
      Object.entries(context.questions).map(([id, question]) => [
        id,
        question.type === "bool" ? { ...question, type: "noul" } : question,
      ]),
    ),
  };
}

const requestSystemOne = Effect.fn("requestSystemOne")(function* (
  transport: SystemOneTransport,
  model: ClassifierModel<ClassifierApi>,
  context: ClassifierContext,
  options: ClassifierOptions | undefined,
  output: ClassifierResult,
) {
  if (model.api !== transport.api)
    return yield* Effect.die(new Error(`Unsupported classifier API: ${model.api}`));
  if (context.images?.length !== undefined && context.images?.length > 0)
    return yield* Effect.die(new Error(`${transport.label} does not support image input`));
  const body = yield* classifierRequest({
    label: transport.label,
    url: transport.url(model),
    model,
    body: transport.payload(model, wireRequest(context)),
    options,
  });
  const result = transport.output(body);
  const usage = parseClassifierUsage(result["usage"], model);
  if (usage !== undefined) output.usage = usage;
  output.answers = parseAnswers(transport.label, result["answers"], context);
  return output;
});

export const classifySystemOne: {
  (
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options: ClassifierOptions | undefined,
  ): (transport: SystemOneTransport) => Promise<ClassifierResult>;
  (
    transport: SystemOneTransport,
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options: ClassifierOptions | undefined,
  ): Promise<ClassifierResult>;
} = Function.dual(
  4,
  function (
    transport: SystemOneTransport,
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options: ClassifierOptions | undefined,
  ): Promise<ClassifierResult> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const output: ClassifierResult = {
          api: model.api,
          provider: model.provider,
          model: model.id,
          answers: {},
          stopReason: "stop",
          timestamp: yield* Clock.currentTimeMillis,
        };
        return yield* requestSystemOne(transport, model, context, options, output).pipe(
          Effect.catchDefect((error) =>
            Effect.sync((): ClassifierResult => {
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
