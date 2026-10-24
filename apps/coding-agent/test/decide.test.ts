import localModule from "@msa/ai/providers/local";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import decideSupport from "./decide-support.ts";

const { listen, runTest } = testing;
const { LIQUID_D1 } = localModule;
const { FIXTURE, blocking, classifierAt, cleanUp, localDecide, request } = decideSupport;

afterEach(() => runTest(cleanUp));

const holdsFromTheThresholdUp = () =>
  runTest(
    Effect.gen(function* () {
      const { decide, recorded } = yield* localDecide(classifierAt(FIXTURE));

      const open = yield* decide(blocking(0));
      if (open.status !== "decided") throw new Error(open.reason);
      const answer = open.answers["blocking"];
      if (answer?.type !== "bool") throw new Error("expected a bool answer");
      const { probability } = answer;
      expect(probability).toBeGreaterThan(0);
      expect(probability).toBeLessThan(1);
      const at = yield* decide(blocking(probability));
      const above = yield* decide(blocking(probability + 1e-9));

      expect(answer.holds).toBe(true);
      expect(at).toEqual({ ...open, answers: { blocking: { ...answer, holds: true } } });
      expect(above).toEqual({ ...open, answers: { blocking: { ...answer, holds: false } } });
      expect(recorded.classifications).toBe(1);
    }),
  );
const appliesEachQuestionsThreshold = () =>
  runTest(
    Effect.gen(function* () {
      const { decide, recorded } = yield* localDecide(classifierAt(FIXTURE));

      const open = yield* decide(request("The build fails.", { route: 0, severity: 0 }));
      const strict = yield* decide(request("The build fails.", { route: 1, severity: 1 }));

      if (open.status !== "decided") throw new Error(open.reason);
      if (strict.status !== "decided") throw new Error(strict.reason);
      expect(open.model).toBe(`${LIQUID_D1.provider}/${LIQUID_D1.id}`);
      const route = open.answers["route"];
      const strictRoute = strict.answers["route"];
      if (route?.type !== "choice" || strictRoute?.type !== "choice")
        throw new Error("expected choice answers");
      expect(["billing", "technical"]).toContain(route.choice);
      expect(strictRoute.choice).toBeUndefined();
      expect(strictRoute.probabilities).toEqual(route.probabilities);
      const severity = open.answers["severity"];
      const strictSeverity = strict.answers["severity"];
      if (severity?.type !== "score" || strictSeverity?.type !== "score")
        throw new Error("expected score answers");
      expect(severity.level).toBe(Math.round(severity.score));
      expect(strictSeverity.level).toBeUndefined();
      expect(recorded.classifications).toBe(1);
      expect(recorded.undecided).toEqual([]);
    }),
  );

const letsSettingsOverrideTheThreshold = () =>
  runTest(
    Effect.gen(function* () {
      const { decide } = yield* localDecide(classifierAt(FIXTURE), {
        thresholds: { "triage.route": 1 },
      });

      const decision = yield* decide(request("The build fails.", { route: 0, severity: 0 }));

      if (decision.status !== "decided") throw new Error(decision.reason);
      const route = decision.answers["route"];
      const severity = decision.answers["severity"];
      if (route?.type !== "choice" || severity?.type !== "score")
        throw new Error("expected choice and score answers");
      expect(route.choice).toBeUndefined();
      expect(severity.level).toBeDefined();
    }),
  );

const answersTheSameInputFromItsCache = () =>
  runTest(
    Effect.gen(function* () {
      const { decide, recorded } = yield* localDecide(classifierAt(FIXTURE));

      const first = yield* decide(request("The build fails.", { route: 0, severity: 0 }));
      const again = yield* decide(request("The build fails.", { route: 0, severity: 0 }));
      expect(recorded.classifications).toBe(1);
      yield* decide(request("The invoice is wrong.", { route: 0, severity: 0 }));

      expect(again).toEqual(first);
      expect(recorded.classifications).toBe(2);
    }),
  );

const isUndecidedWithoutADecisionModel = () =>
  runTest(
    Effect.gen(function* () {
      const reason = 'decision.model "local/none" is not an available classifier';
      const { decide, recorded } = yield* localDecide(classifierAt(FIXTURE), {
        unavailable: reason,
      });

      const decision = yield* decide(request("The build fails.", { route: 0, severity: 0 }));

      expect(decision).toEqual({ reason, status: "undecided" });
      expect(recorded.classifications).toBe(0);
      expect(recorded.undecided).toEqual([{ name: "triage", reason }]);
    }),
  );

const retriesAFailedDownloadOnTheNextCall = () =>
  runTest(
    Effect.gen(function* () {
      const origin = yield* listen(() =>
        Effect.succeed(new Response("not found", { status: 404 })),
      );
      const { decide, recorded } = yield* localDecide(classifierAt("hf:example/missing/m.gguf"), {
        endpoints: { huggingFace: `${origin}/` },
      });

      const first = yield* decide(request("The build fails.", { route: 0, severity: 0 }));
      const second = yield* decide(request("The build fails.", { route: 0, severity: 0 }));

      expect(first.status).toBe("undecided");
      expect(second.status).toBe("undecided");
      expect(recorded.classifications).toBe(2);
      expect(recorded.undecided.map(({ name }) => name)).toEqual(["triage", "triage"]);
    }),
  );

describe("decide", () => {
  it(
    "holds a bool answer when its probability reaches the threshold and not above it",
    holdsFromTheThresholdUp,
  );

  it(
    "turns the model's probabilities into answers through each question's threshold",
    appliesEachQuestionsThreshold,
  );

  it(
    "lets the settings threshold of a decision question override the tool's own",
    letsSettingsOverrideTheThreshold,
  );

  it(
    "answers the same input from its cache and asks the model again for a new input",
    answersTheSameInputFromItsCache,
  );

  it(
    "is undecided without asking when the decision model is not available",
    isUndecidedWithoutADecisionModel,
  );

  it(
    "is undecided when the model cannot be downloaded, and tries again on the next call",
    retriesAFailedDownloadOnTheNextCall,
  );
});
