import type aiTypes from "@msa/ai/index.types";
import localModule from "@msa/ai/providers/local";
import { Effect } from "effect";

import Decide from "../src/core/decision/decide-service.ts";
import decideModule from "../src/core/decision/decide.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";

const { LIQUID_D1 } = localModule;
const { decide, makeDecide } = decideModule;

type Odds = Readonly<Record<string, number>>;

type Judgement = (state: aiTypes.JsonObject) => Odds;

interface Judges {
  verdict: Judgement;
  goal?: Judgement;
  progress?: Judgement;
}

function choiceAnswer(odds: Odds): aiTypes.ClassifierAnswer {
  const [choice, confidence] = Object.entries(odds).reduce((best, entry) =>
    entry[1] > best[1] ? entry : best,
  );
  return { choice, confidence, probabilities: { ...odds }, type: "choice" };
}

function judgesOf(judgement: Judgement | Judges): Required<Judges> {
  const judges = typeof judgement === "function" ? { verdict: judgement } : judgement;
  return {
    goal:
      judges.goal ??
      ((state) => {
        const odds = judges.verdict(state);
        return { met: odds["pass"] ?? 0, unmet: odds["fail"] ?? 0 };
      }),
    progress: judges.progress ?? (() => ({ moving: 1, stuck: 0 })),
    verdict: judges.verdict,
  };
}

function answersFor(
  judges: Required<Judges>,
  questions: readonly string[],
  state: aiTypes.JsonObject,
): Record<string, aiTypes.ClassifierAnswer> {
  return Object.fromEntries(
    questions.map((id) => {
      const judge =
        id === "goal" ? judges.goal : id === "progress" ? judges.progress : judges.verdict;
      return [id, choiceAnswer(judge(state))];
    }),
  );
}

function classifierDecide(
  judgement: Judgement | Judges | { unavailable: string },
): orchestratorTypes.OrchestratorOptions["decide"] {
  const available = "unavailable" in judgement ? undefined : judgesOf(judgement);
  const service = Effect.runSync(
    makeDecide({
      classify: (model, context) => {
        if (available === undefined)
          throw new Error((judgement as { unavailable: string }).unavailable);
        return Promise.resolve({
          answers: answersFor(available, Object.keys(context.questions), context.state),
          api: model.api,
          model: model.id,
          provider: model.provider,
          stopReason: "stop",
          timestamp: 0,
        });
      },
      model: () =>
        available === undefined
          ? { unavailable: (judgement as { unavailable: string }).unavailable }
          : { model: LIQUID_D1 },
      recordUndecided: () => undefined,
      recordUsage: () => undefined,
      threshold: () => undefined,
    }),
  );
  return (request) =>
    Effect.runPromise(decide(request).pipe(Effect.provideService(Decide, service)));
}

const PASSING: Odds = { fail: 0, pass: 1 };

const passingDecide = classifierDecide(() => PASSING);

function reportOf(state: aiTypes.JsonObject): string {
  return typeof state["report"] === "string" ? state["report"] : "";
}

const reviewVerdictSupport = { PASSING, classifierDecide, passingDecide, reportOf };

export default reviewVerdictSupport;
