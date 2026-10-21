import type aiTypes from "@msa/ai/index.types";
import localModule from "@msa/ai/providers/local";
import testing from "@msa/testing";
import { Clock, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it } from "vite-plus/test";

import decideModule from "../src/core/decision/decide.ts";
import type decideTypes from "../src/core/decision/decide.types.ts";

const { closeServers, joinPath, listen, makeTempDir, removeDirs, runTest } = testing;
const { LIQUID_D1, localProvider } = localModule;
const { DECISION_TIMEOUT, makeDecide } = decideModule;

const FIXTURE = joinPath(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "libs",
  "ai",
  "test",
  "fixtures",
  "stories260K.gguf",
);

const directories: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* closeServers;
      yield* removeDirs(directories.splice(0));
    }),
  ),
);

const classifierAt = (baseUrl: string): aiTypes.ClassifierModel<"node-llama-cpp-classify"> => ({
  ...LIQUID_D1,
  baseUrl,
  contextWindow: 4096,
});

const request = (
  ticket: string,
  thresholds: { route: number; severity: number },
): decideTypes.DecideRequest => ({
  name: "triage",
  questions: {
    route: {
      criteria: { billing: "money", technical: "code" },
      instructions: "Which team should answer?",
      threshold: thresholds.route,
      type: "choice",
    },
    severity: {
      criteria: ["minor", "moderate", "severe"],
      instructions: "How severe is it?",
      threshold: thresholds.severity,
      type: "score",
    },
  },
  state: { ticket },
});

interface Recorded {
  classifications: number;
  undecided: Array<{ name: string; reason: string }>;
  usage: aiTypes.ClassifierResult[];
}

const localHost = Effect.fn("localHost")(function* (
  model: aiTypes.ClassifierModel<"node-llama-cpp-classify">,
  options: {
    endpoints?: { huggingFace: string };
    thresholds?: Record<string, number>;
    unavailable?: string;
  } = {},
) {
  const directory = yield* makeTempDir("msa-decide-");
  directories.push(directory);
  const provider = localProvider(
    { directory, ...(options.endpoints === undefined ? {} : { endpoints: options.endpoints }) },
    [model],
  );
  const recorded: Recorded = { classifications: 0, undecided: [], usage: [] };
  const host: decideTypes.DecisionHost = {
    classify: (classifier, context, signal) => {
      recorded.classifications += 1;
      return provider.classify!(classifier, context, { signal });
    },
    model: () =>
      options.unavailable === undefined ? { model } : { unavailable: options.unavailable },
    recordUndecided: (name, reason) => recorded.undecided.push({ name, reason }),
    recordUsage: (result) => recorded.usage.push(result),
    threshold: (key) => options.thresholds?.[key],
  };
  return { host, recorded };
});
const appliesEachQuestionsThreshold = () =>
  runTest(
    Effect.gen(function* () {
      const { host, recorded } = yield* localHost(classifierAt(FIXTURE));
      const { decide } = yield* makeDecide(host);

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
      const { host } = yield* localHost(classifierAt(FIXTURE), {
        thresholds: { "triage.route": 1 },
      });
      const { decide } = yield* makeDecide(host);

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
      const { host, recorded } = yield* localHost(classifierAt(FIXTURE));
      const { decide } = yield* makeDecide(host);

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
      const { host, recorded } = yield* localHost(classifierAt(FIXTURE), { unavailable: reason });
      const { decide } = yield* makeDecide(host);

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
      const { host, recorded } = yield* localHost(classifierAt("hf:example/missing/m.gguf"), {
        endpoints: { huggingFace: `${origin}/` },
      });
      const { decide } = yield* makeDecide(host);

      const first = yield* decide(request("The build fails.", { route: 0, severity: 0 }));
      const second = yield* decide(request("The build fails.", { route: 0, severity: 0 }));

      expect(first.status).toBe("undecided");
      expect(second.status).toBe("undecided");
      expect(recorded.classifications).toBe(2);
      expect(recorded.undecided.map(({ name }) => name)).toEqual(["triage", "triage"]);
    }),
  );

const isUndecidedWhenTheModelIsLate = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const origin = yield* listen(() => Effect.never);
        const { host, recorded } = yield* localHost(classifierAt("hf:example/slow/m.gguf"), {
          endpoints: { huggingFace: `${origin}/` },
        });
        const { decide } = yield* makeDecide(host);
        const clock = yield* TestClock.make();

        const fiber = yield* decide(request("The build fails.", { route: 0, severity: 0 })).pipe(
          Effect.provideService(Clock.Clock, clock),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* clock.adjust(Duration.sum(DECISION_TIMEOUT, Duration.millis(1)));
        const decision = yield* Fiber.join(fiber);

        expect(decision).toEqual({
          reason: `no answer within ${Duration.format(DECISION_TIMEOUT)}`,
          status: "undecided",
        });
        expect(recorded.undecided).toHaveLength(1);
      }),
    ),
  );

describe("decide", () => {
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

  it("is undecided when the model does not answer in time", isUndecidedWhenTheModelIsLate);
});
