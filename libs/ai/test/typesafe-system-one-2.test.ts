import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { classify } from "../src/api/typesafe-system-one.ts";
import type { ClassifierContext } from "../src/types.ts";
import jsonCodec from "./json-codec.ts";
import typesafeSystemOneSupport from "./typesafe-system-one-support.ts";

const { context, model, wireAnswers } = typesafeSystemOneSupport;

const { decodeJson, encodeJson } = jsonCodec;

describe("TypeSafe System One", () => {
  it("preserves prototype-sensitive question IDs in answers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const prototypeContext: ClassifierContext = {
          questions: (yield* decodeJson(
            '{"__proto__":{"type":"bool","instructions":"Is this true?","criteria":{"true":"Yes","false":"No"}}}',
          )) as ClassifierContext["questions"],
          state: {},
        };
        const result = yield* Effect.promise(() =>
          classify(model, prototypeContext, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({ answers: JSON.parse('{"__proto__":{"type":"noul","noul":0.75}}') }),
              ),
          }),
        );

        const serializedAnswers = (yield* decodeJson(yield* encodeJson(result.answers))) as Record<
          string,
          unknown
        >;
        expect(result.stopReason).toBe("stop");
        expect(Object.keys(result.answers)).toEqual(["__proto__"]);
        expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
        expect(result.answers["__proto__"]).toEqual({ probability: 0.75, type: "bool" });
        expect(serializedAnswers["__proto__"]).toEqual({ probability: 0.75, type: "bool" });
      }),
    ));
});

const hangUntilAborted = (
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const signal = init?.signal;
  if (signal === undefined || signal === null) {
    return Promise.reject(new Error("missing request signal"));
  }
  return Effect.runPromise(Effect.never, { signal });
};

describe("TypeSafe System One", () => {
  it("reports request timeouts separately from caller cancellation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: hangUntilAborted,
            maxRetries: 0,
            timeoutMs: 5,
          }),
        );

        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toBe("Request timed out after 5ms");
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("creates a fresh timeout for every retry attempt", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const signals: AbortSignal[] = [];
        let attempt = 0;
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: (_input, init) => {
              if (!(init?.signal instanceof AbortSignal))
                return Promise.reject(new Error("missing request signal"));
              signals.push(init.signal);
              attempt++;
              return Promise.resolve(
                attempt === 1
                  ? new Response("retry", { headers: { "retry-after-ms": "0" }, status: 500 })
                  : Response.json({ answers: wireAnswers }),
              );
            },
            maxRetries: 1,
            timeoutMs: 1000,
          }),
        );

        expect(result.stopReason).toBe("stop");
        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("returns malformed responses as classifier errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({ answers: {}, usage: { input_tokens: 10, output_tokens: 2 } }),
              ),
          }),
        );

        expect(result.stopReason).toBe("error");
        expect(result.answers).toEqual({});
        expect(result.errorMessage).toContain("did not return an answer for category");
        expect(result.usage).toMatchObject({ input: 10, output: 2 });
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("ignores malformed usage", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  answers: wireAnswers,
                  usage: { input_tokens: "many", output_tokens: 3 },
                }),
              ),
          }),
        );
        const withoutTokens = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(Response.json({ answers: wireAnswers, usage: { cost: 0.1 } })),
          }),
        );

        expect(result.stopReason).toBe("stop");
        expect(result.usage).toMatchObject({ input: 0, output: 3, totalTokens: 3 });
        expect(withoutTokens.stopReason).toBe("stop");
        expect(withoutTokens.usage).toBeUndefined();
      }),
    ));
});
