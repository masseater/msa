import type aiTypes from "@msa/ai/index.types";
import { Cache, Context, Duration, Effect, Exit, Schema } from "effect";

import Decide from "./decide-service.ts";
import type decideTypes from "./decide.types.ts";
import Undecided from "./undecided.ts";

const DECISION_TIMEOUT = Duration.seconds(15);
const CACHE_CAPACITY = 512;

class PendingClassification extends Context.Service<
  PendingClassification,
  {
    readonly model: aiTypes.ClassifierModel<aiTypes.ClassifierApi>;
    readonly context: aiTypes.ClassifierContext;
  }
>()("@msa/coding-agent/core/decision/decide/PendingClassification") {}

type AnswerCache = Cache.Cache<
  string,
  Record<string, aiTypes.ClassifierAnswer>,
  Undecided,
  PendingClassification
>;

const encodeKey = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const classifyPending = (host: decideTypes.DecisionHost) =>
  Effect.gen(function* () {
    const { model, context } = yield* PendingClassification;
    const result = yield* Effect.tryPromise({
      catch: (error) => Undecided.make({ reason: errorText(error) }),
      try: (signal) => host.classify(model, context, signal),
    });
    if (result.stopReason !== "stop")
      return yield* Undecided.make({ reason: result.errorMessage ?? result.stopReason });
    host.recordUsage(result);
    return result.answers;
  }).pipe(
    Effect.timeoutOrElse({
      duration: DECISION_TIMEOUT,
      orElse: () =>
        Effect.fail(
          Undecided.make({ reason: `no answer within ${Duration.format(DECISION_TIMEOUT)}` }),
        ),
    }),
  );

function topChoice(probabilities: Readonly<Record<string, number>>): [string, number] | undefined {
  let best: [string, number] | undefined;
  for (const entry of Object.entries(probabilities)) {
    if (best === undefined || entry[1] > best[1]) best = entry;
  }
  return best;
}

function applyThreshold(
  answer: aiTypes.ClassifierAnswer,
  threshold: number,
): decideTypes.DecisionAnswer {
  if (answer.type === "bool")
    return {
      holds: answer.probability >= threshold,
      probability: answer.probability,
      type: "bool",
    };
  if (answer.type === "score")
    return {
      confidence: answer.confidence,
      level: answer.confidence >= threshold ? Math.round(answer.score) : undefined,
      score: answer.score,
      type: "score",
    };
  const top = topChoice(answer.probabilities);
  return {
    choice: top !== undefined && top[1] >= threshold ? top[0] : undefined,
    probabilities: answer.probabilities,
    type: "choice",
  };
}

function classifierQuestions(
  questions: decideTypes.DecideRequest["questions"],
): Record<string, aiTypes.ClassifierQuestion> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, { threshold: _threshold, ...question }]) => [
      id,
      question as aiTypes.ClassifierQuestion,
    ]),
  );
}

const thresholdedAnswers = Effect.fn("thresholdedAnswers")(function* (
  host: decideTypes.DecisionHost,
  request: decideTypes.DecideRequest,
  answers: Readonly<Record<string, aiTypes.ClassifierAnswer>>,
) {
  const decided: Array<[string, decideTypes.DecisionAnswer]> = [];
  const answered = new Map(Object.entries(answers));
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = answered.get(id);
    if (answer === undefined) return yield* Undecided.make({ reason: `no answer for ${id}` });
    const threshold = host.threshold(`${request.name}.${id}`) ?? question.threshold;
    decided.push([id, applyThreshold(answer, threshold)]);
  }
  return Object.fromEntries(decided);
});

const decideWith = Effect.fn("decide")(function* (
  host: decideTypes.DecisionHost,
  cache: AnswerCache,
  request: decideTypes.DecideRequest,
) {
  const resolved = host.model();
  if ("unavailable" in resolved) return yield* Undecided.make({ reason: resolved.unavailable });
  const { model } = resolved;
  const context = { questions: classifierQuestions(request.questions), state: request.state };
  const key = yield* encodeKey([model.provider, model.id, context.state, context.questions]).pipe(
    Effect.mapError((error) => Undecided.make({ reason: error.message })),
  );
  const answers = yield* Cache.get(cache, key).pipe(
    Effect.provideService(PendingClassification, { context, model }),
  );
  const decision: decideTypes.Decision = {
    answers: yield* thresholdedAnswers(host, request, answers),
    model: `${model.provider}/${model.id}`,
    status: "decided",
  };
  return decision;
});

const makeDecide = (host: decideTypes.DecisionHost) =>
  Effect.gen(function* () {
    const cache: AnswerCache = yield* Cache.makeWith((_key: string) => classifyPending(host), {
      capacity: CACHE_CAPACITY,
      requireServicesAt: "lookup",
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
    });
    return Decide.of({
      decide: (request) =>
        decideWith(host, cache, request).pipe(
          Effect.catchDefect((defect) =>
            Effect.fail(Undecided.make({ reason: errorText(defect) })),
          ),
          Effect.catchTag("Undecided", ({ reason }) =>
            Effect.sync((): decideTypes.Decision => {
              host.recordUndecided(request.name, reason);
              return { reason, status: "undecided" };
            }),
          ),
        ),
    });
  });

const decide = (request: decideTypes.DecideRequest) =>
  Decide.use((service) => service.decide(request));

const decideModule = { DECISION_TIMEOUT, decide, makeDecide };

export default decideModule;
