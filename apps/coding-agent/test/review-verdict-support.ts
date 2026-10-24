import type aiTypes from "@msa/ai/index.types";
import localModule from "@msa/ai/providers/local";
import { Effect } from "effect";

import Decide from "../src/core/decision/decide-service.ts";
import decideModule from "../src/core/decision/decide.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";

const { LIQUID_D1 } = localModule;
const { decide, makeDecide } = decideModule;

type Odds = Readonly<Record<"pass" | "fail", number>>;

type Judgement = (state: aiTypes.JsonObject) => Odds;

function verdictAnswer(odds: Odds): aiTypes.ClassifierAnswer {
  const choice = odds.fail > odds.pass ? "fail" : "pass";
  return { choice, confidence: odds[choice], probabilities: { ...odds }, type: "choice" };
}

function classifierDecide(
  judgement: Judgement | { unavailable: string },
): orchestratorTypes.OrchestratorOptions["decide"] {
  const service = Effect.runSync(
    makeDecide({
      classify: (model, context) => {
        if (typeof judgement !== "function") throw new Error(judgement.unavailable);
        return Promise.resolve({
          answers: Object.fromEntries(
            Object.keys(context.questions).map((id) => [
              id,
              verdictAnswer(judgement(context.state)),
            ]),
          ),
          api: model.api,
          model: model.id,
          provider: model.provider,
          stopReason: "stop",
          timestamp: 0,
        });
      },
      model: () =>
        typeof judgement === "function"
          ? { model: LIQUID_D1 }
          : { unavailable: judgement.unavailable },
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
