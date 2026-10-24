import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, expect, it } from "vite-plus/test";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import decideSupport from "./decide-support.ts";
import orchestratorSdkSupport from "./orchestrator-sdk-support.ts";

const { removePath, runTest } = testing;
const { FIXTURE } = decideSupport;
const { createHarness, tempDir } = orchestratorSdkSupport;

afterAll(() => runTest(removePath(tempDir)));

const CLASSIFIER = { id: "fixture", provider: "local" } as const;

const reviewRequest = {
  name: "review",
  questions: {
    verdict: {
      criteria: { fail: "a problem within the goal remains", pass: "no problem remains" },
      instructions: "Does a problem within the goal remain to be fixed?",
      threshold: 0.7,
      type: "choice",
    },
  },
  state: { goalState: "the cache serves repeated reads", report: "The goal holds." },
} as const;

const sessionWithClassifierAt = (path: string) =>
  createHarness({
    register: (modelRuntime) =>
      modelRuntime.registerProvider(CLASSIFIER.provider, {
        models: [
          {
            api: "node-llama-cpp-classify",
            baseUrl: path,
            contextWindow: 4096,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
            id: CLASSIFIER.id,
            input: ["text"],
            name: "Fixture classifier",
            type: "classifier",
          },
        ],
      }),
    settings: { decision: { model: `${CLASSIFIER.provider}/${CLASSIFIER.id}` } },
  });

const decidesAReviewThatArrivesBeforeTheDecisionModelLoads = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* sessionWithClassifierAt(FIXTURE);

      const decision = yield* Effect.promise(() =>
        orchestratorCallbacks.decide(session, reviewRequest),
      );

      expect(decision).toMatchObject({
        model: `${CLASSIFIER.provider}/${CLASSIFIER.id}`,
        status: "decided",
      });
      session.dispose();
    }),
  );

it(
  "decides a task review that arrives before the decision model has loaded, instead of leaving it undecided",
  decidesAReviewThatArrivesBeforeTheDecisionModelLoads,
  60_000,
);

const namesTheLoadFailureWhenTheDecisionModelCannotLoad = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { session } = yield* sessionWithClassifierAt(`${tempDir}/missing.gguf`);

      const decision = yield* Effect.promise(() =>
        orchestratorCallbacks.decide(session, reviewRequest),
      );

      expect(decision.status).toBe("undecided");
      if (decision.status !== "undecided") return;
      expect(decision.reason).toMatch(/^could not load local\/fixture: /u);
      expect(decision.reason).not.toContain("has not loaded");
      session.dispose();
    }),
  );

it(
  "leaves a task review undecided with the reason the decision model could not load",
  namesTheLoadFailureWhenTheDecisionModelCannotLoad,
  60_000,
);
