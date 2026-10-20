import { Clock, Effect } from "effect";

import type typesModule from "../types.types.ts";
import errorBody from "../utils/error-body.ts";
import modelCallModule from "../utils/model-call.ts";
import classifierShared from "./classifier-shared.ts";
import type classifierSharedTypes from "./classifier-shared.types.ts";

const { classifierRequest, isRecord, parseClassifierUsage, requiredNumber } = classifierShared;
const { formatProviderError, normalizeProviderError } = errorBody;
const { modelCall } = modelCallModule;

const LABEL = "OpenAI Decisions";

const MAX_IMAGES = 128;

interface DecisionQuestion {
  type: "predicate" | "choice" | "score";
  name: string;
  instructions: string;
  choices?: Array<{ value: string; description?: string }>;
  levels?: Array<{ label: string }>;
}

function predicateInstructions(
  question: Extract<typesModule.ClassifierQuestion, { type: "bool" }>,
): string {
  const meanings = [
    question.criteria.true === "" ? "" : `True means: ${question.criteria.true}`,
    question.criteria.false === "" ? "" : `False means: ${question.criteria.false}`,
  ].filter(Boolean);
  return meanings.length > 0
    ? `${question.instructions}\n\n${meanings.join("\n")}`
    : question.instructions;
}

function wireQuestion(name: string, question: typesModule.ClassifierQuestion): DecisionQuestion {
  if (question.type === "choice") {
    return {
      choices: Object.entries(question.criteria).map(([value, description]) =>
        description === "" ? { value } : { description, value },
      ),
      instructions: question.instructions,
      name,
      type: "choice",
    };
  }
  if (question.type === "score") {
    return {
      instructions: question.instructions,
      levels: question.criteria.map((label) => ({ label })),
      name,
      type: "score",
    };
  }
  return { instructions: predicateInstructions(question), name, type: "predicate" };
}

function wireInput(context: typesModule.ClassifierContext): unknown {
  const state = JSON.stringify(context.state);
  const images = context.images ?? [];
  if (images.length === 0) return state;
  if (images.length > MAX_IMAGES) {
    throw new Error(`${LABEL} accepts at most ${MAX_IMAGES} images, got ${images.length}`);
  }
  return [
    {
      content: [
        { text: state, type: "input_text" },
        ...images.map((image) => ({
          image_url: `data:${image.mimeType};base64,${image.data}`,
          type: "input_image",
        })),
      ],
      role: "user",
    },
  ];
}

function choiceProbabilities(value: unknown, id: string): Record<string, number> {
  if (!Array.isArray(value)) throw new Error(`${LABEL} returned invalid probabilities for ${id}`);
  return Object.fromEntries(
    value.map((entry) => {
      if (!isRecord(entry) || typeof entry["value"] !== "string") {
        throw new Error(`${LABEL} returned invalid probabilities for ${id}`);
      }
      return [
        entry["value"],
        requiredNumber(LABEL, entry["probability"], `probability for ${id}.${entry["value"]}`),
      ];
    }),
  );
}

function parseAnswer(
  id: string,
  question: typesModule.ClassifierQuestion,
  answer: Record<string, unknown>,
): typesModule.ClassifierAnswer {
  if (answer["type"] === "refusal") throw new Error(`${LABEL} refused to answer ${id}`);
  if (question.type === "choice") {
    if (answer["type"] !== "choice" || typeof answer["choice"] !== "string") {
      throw new Error(`${LABEL} did not return a choice answer for ${id}`);
    }
    return {
      choice: answer["choice"],
      confidence: requiredNumber(LABEL, answer["confidence"], `confidence for ${id}`),
      probabilities: choiceProbabilities(answer["probabilities"], id),
      type: "choice",
    };
  }
  if (question.type === "score") {
    if (answer["type"] !== "score")
      throw new Error(`${LABEL} did not return a score answer for ${id}`);
    return {
      confidence: requiredNumber(LABEL, answer["confidence"], `confidence for ${id}`),
      score: requiredNumber(LABEL, answer["score"], `score for ${id}`),
      type: "score",
    };
  }
  if (answer["type"] !== "predicate")
    throw new Error(`${LABEL} did not return a predicate answer for ${id}`);
  return {
    probability: requiredNumber(LABEL, answer["probability"], `probability for ${id}`),
    type: "bool",
  };
}

function parseAnswers(
  value: unknown,
  context: typesModule.ClassifierContext,
): Record<string, typesModule.ClassifierAnswer> {
  if (!Array.isArray(value)) throw new Error(`${LABEL} returned an unexpected response`);
  const byName = new Map<string, Record<string, unknown>>();
  for (const answer of value) {
    if (isRecord(answer) && typeof answer["name"] === "string") byName.set(answer["name"], answer);
  }
  return Object.fromEntries(
    Object.entries(context.questions).map(([id, question]) => {
      const answer = byName.get(id);
      if (answer === undefined) throw new Error(`${LABEL} did not return an answer for ${id}`);
      return [id, parseAnswer(id, question, answer)];
    }),
  );
}

const NO_RETRY_STATUSES = [504];

function errorMessage(error: unknown): string {
  if ((error as Partial<classifierSharedTypes.ClassifierHttpError>).status === 504) {
    return `${LABEL} error (504): the request timed out at the gateway. Very large inputs (above roughly 600K tokens) currently exceed its time limit.`;
  }
  return formatProviderError(normalizeProviderError(error), `${LABEL} error`);
}

const requestDecisions = Effect.fn("requestDecisions")(function* (
  model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  context: typesModule.ClassifierContext,
  options: typesModule.ClassifierOptions | undefined,
  output: typesModule.ClassifierResult,
) {
  if (model.api !== "openai-decisions")
    return yield* Effect.die(new Error(`Unsupported classifier API: ${model.api}`));
  const body = yield* classifierRequest({
    body: {
      input: wireInput(context),
      model: model.id,
      questions: Object.entries(context.questions).map(([id, question]) =>
        wireQuestion(id, question),
      ),
    },
    label: LABEL,
    model,
    noRetryStatuses: NO_RETRY_STATUSES,
    options,
    url: new URL("decisions", `${model.baseUrl.replace(/\/+$/u, "")}/`),
  });
  if (!isRecord(body))
    return yield* Effect.die(new Error(`${LABEL} returned an unexpected response`));
  const usage = parseClassifierUsage(body["usage"], model);
  if (usage !== undefined) output.usage = usage;
  output.answers = parseAnswers(body["answers"], context);
  return output;
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
      return yield* requestDecisions(model, context, options, output).pipe(
        Effect.catchDefect((error) =>
          Effect.sync((): typesModule.ClassifierResult => {
            output.answers = {};
            output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
            output.errorMessage = errorMessage(error);
            return output;
          }),
        ),
      );
    }),
  ),
);

const openaiDecisions = {
  classify,
};

export default openaiDecisions;
