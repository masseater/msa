import { APIError } from "@anthropic-ai/sdk";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import anthropicStrictToolFallbackSupport from "./anthropic-strict-tool-fallback-support.ts";

const { stream: streamAnthropic } = anthropicMessages;

const { context, errorResponse, grammarError, harness, model, successResponse, tool } =
  anthropicStrictToolFallbackSupport;

const surfacesASecondRejectionRatherThan = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payloads, options } = harness((_payload, attempt) =>
        errorResponse(attempt === 1 ? grammarError : "Required grammar is still too large"),
      );
      const result = yield* Effect.promise(() =>
        streamAnthropic(
          model,
          context([tool("lookup", "prefer"), tool("required", "require")]),
          options,
        ).result(),
      );
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("Required grammar is still too large");
      expect(payloads).toHaveLength(2);
      const retriedPayload = payloads[1];
      if (retriedPayload === undefined) throw new Error("Expected a retried payload");
      expect((retriedPayload.tools as BetaTool[])[1]?.strict).toBe(true);
    }),
  );

const doesNotDowngradeAHookException = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payloads, options } = harness(() => successResponse());
      const result = yield* Effect.promise(() =>
        streamAnthropic(model, context([tool("lookup", "prefer")]), {
          ...options,
          onPayload: () => {
            throw APIError.generate(
              400,
              { error: { message: grammarError, type: "invalid_request_error" } },
              grammarError,
              new Headers(),
            );
          },
        }).result(),
      );
      expect(result.stopReason).toBe("error");
      expect(payloads).toHaveLength(0);
      expect(result.diagnostics).toBeUndefined();
    }),
  );

const honorsCancellationBeforeTheFallbackAttempt = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const { payloads, options } = harness(() => {
        controller.abort();
        return errorResponse();
      });
      const result = yield* Effect.promise(() =>
        streamAnthropic(model, context([tool("lookup", "prefer")]), {
          ...options,
          signal: controller.signal,
        }).result(),
      );
      expect(result.stopReason).toBe("aborted");
      expect(payloads).toHaveLength(1);
    }),
  );
};

const doesNotRetryAnSSEError = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payloads, options } = harness(
        () =>
          new Response(
            `event: error\ndata: ${JSON.stringify({ error: { message: grammarError, type: "invalid_request_error" }, type: "error" })}\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          ),
      );
      const result = yield* Effect.promise(() =>
        streamAnthropic(model, context([tool("lookup", "prefer")]), options).result(),
      );
      expect(result.stopReason).toBe("error");
      expect(payloads).toHaveLength(1);
    }),
  );

const doesNotDisableStrictSamplingOn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payloads, options } = harness((_payload, attempt) =>
        attempt === 1 ? errorResponse() : successResponse(),
      );
      const transcript = context([tool("lookup", "prefer")]);
      yield* Effect.promise(() => streamAnthropic(model, transcript, options).result());
      yield* Effect.promise(() => streamAnthropic(model, transcript, options).result());
      expect(payloads.map((payload) => (payload.tools as BetaTool[])[0]?.strict)).toEqual([
        true,
        undefined,
        true,
      ]);
    }),
  );

describe("Anthropic preferred strict tool fallback", () => {
  it.each([
    ["required", [tool("lookup", "require")]],
    ["ordinary", [tool("lookup")]],
    [
      "locally unsupported prefer",
      [
        {
          ...tool("lookup", "prefer"),
          parameters: Type.Object({ value: Type.Number({ minimum: 1 }) }),
        },
      ],
    ],
  ])("does not retry a %s tool set", (_name, tools) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { payloads, options } = harness(() => errorResponse());
        const result = yield* Effect.promise(() =>
          streamAnthropic(model, context(tools), options).result(),
        );
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain(grammarError);
        expect(payloads).toHaveLength(1);
      }),
    ),
  );

  it.each([
    ["unrelated 400", "Invalid tool schema", 400, "invalid_request_error"],
    ["wrong error type", grammarError, 400, "authentication_error"],
    ["wrong HTTP status", grammarError, 500, "invalid_request_error"],
  ])("does not downgrade on %s", (_name, message, status, type) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { payloads, options } = harness(() => errorResponse(message, status, type));
        const result = yield* Effect.promise(() =>
          streamAnthropic(model, context([tool("lookup", "prefer")]), options).result(),
        );
        expect(result.stopReason).toBe("error");
        expect(payloads).toHaveLength(1);
      }),
    ),
  );
});

describe("Anthropic preferred strict tool fallback", () => {
  it("surfaces a second rejection rather than retrying again", surfacesASecondRejectionRatherThan);

  it(
    "does not downgrade a hook exception, even if it looks like the provider rejection",
    doesNotDowngradeAHookException,
  );
});

describe("Anthropic preferred strict tool fallback", () => {
  it("honors cancellation before the fallback attempt", honorsCancellationBeforeTheFallbackAttempt);

  it("does not retry an SSE error after response headers", doesNotRetryAnSSEError);
});

describe("Anthropic preferred strict tool fallback", () => {
  it("does not disable strict sampling on later requests", doesNotDisableStrictSamplingOn);
});
