import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiDecisions from "../src/api/openai-decisions.ts";
import openaiDecisionsSupport from "./openai-decisions-support.ts";

const { classify } = openaiDecisions;

const { context, model, wireAnswers } = openaiDecisionsSupport;

const doesNotRetryGatewayTimeoutsAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fetch = vi.fn(() =>
        Promise.resolve(
          new Response("<!DOCTYPE html><html>Gateway time-out</html>", {
            headers: { "retry-after-ms": "0" },
            status: 504,
          }),
        ),
      );
      const result = yield* Effect.promise(() =>
        classify(model, context, { apiKey: "secret", fetch }),
      );

      expect(fetch).toHaveBeenCalledOnce();
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain(
        "OpenAI Decisions error (504): the request timed out at the gateway",
      );
      expect(result.errorMessage).not.toContain("<html>");
    }),
  );

const stillRetriesOtherServerErrors = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let attempt = 0;
      const result = yield* Effect.promise(() =>
        classify(model, context, {
          apiKey: "secret",
          fetch: () =>
            Promise.resolve(
              ++attempt === 1
                ? new Response("busy", { headers: { "retry-after-ms": "0" }, status: 503 })
                : Response.json({ answers: wireAnswers }),
            ),
        }),
      );

      expect(attempt).toBe(2);
      expect(result.stopReason).toBe("stop");
    }),
  );

const includesTheAPIErrorBodyFor = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        classify(model, context, {
          apiKey: "secret",
          fetch: () =>
            Promise.resolve(
              Response.json(
                {
                  error: {
                    message: "Decision input exceeds the token limit.",
                    type: "invalid_request_error",
                  },
                },
                { status: 400 },
              ),
            ),
          maxRetries: 0,
        }),
      );

      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("OpenAI Decisions error (400)");
      expect(result.errorMessage).toContain("Decision input exceeds the token limit.");
    }),
  );

const rejectsModelsForOtherClassifierAPIs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fetch = vi.fn(() => Promise.resolve(Response.json({ answers: wireAnswers })));
      const otherApi = yield* Effect.promise(() =>
        classify({ ...model, api: "typesafe-system-one" }, context, {
          apiKey: "secret",
          fetch,
        }),
      );
      const noKey = yield* Effect.promise(() => classify(model, context, { fetch }));

      expect(fetch).not.toHaveBeenCalled();
      expect(otherApi.errorMessage).toContain("Unsupported classifier API: typesafe-system-one");
      expect(noKey.errorMessage).toContain("No API key for provider: openai");
    }),
  );

describe("OpenAI Decisions", () => {
  it(
    "does not retry gateway timeouts and explains them instead of returning the HTML page",
    doesNotRetryGatewayTimeoutsAnd,
  );

  it("still retries other server errors", stillRetriesOtherServerErrors);
});

describe("OpenAI Decisions", () => {
  it("includes the API error body for other HTTP failures", includesTheAPIErrorBodyFor);

  it(
    "rejects models for other classifier APIs and missing API keys",
    rejectsModelsForOtherClassifierAPIs,
  );
});
