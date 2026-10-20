import { DateTime, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiCodexResponses from "../src/api/openai-codex-responses.ts";
import clock from "../src/utils/clock.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { stream: streamOpenAICodexResponses } = openaiCodexResponses;
const { currentTimeMillis } = clock;

const {
  codexModel,
  completedSse,
  mockToken,
  promptContext,
  resetCodexStateAfterEach,
  runCodex,
  sseResponse,
  stubCodexFetch,
} = openaiCodexStreamSupport;

const rateLimited = (headers: Record<string, string>, status = 429) =>
  new Response(
    JSON.stringify({ error: { code: "rate_limit_exceeded", message: "rate limited" } }),
    {
      headers: { "content-type": "application/json", ...headers },
      status,
    },
  );

const failFirst = (failures: number, headers: () => Record<string, string>) =>
  stubCodexFetch((_request, count) =>
    count <= failures ? rateLimited(headers()) : sseResponse(completedSse()),
  );

const startCodex = (options: { maxRetries: number }) =>
  streamOpenAICodexResponses(codexModel(), promptContext(), {
    apiKey: mockToken(),
    transport: "sse",
    ...options,
  }).result();

const advance = (ms: number) => Effect.promise(() => vi.advanceTimersByTimeAsync(ms));
const nextTimer = Effect.promise(() => vi.advanceTimersToNextTimerAsync());

const retryHeaderCases = [
  { delay: 1500, headers: () => ({ "retry-after-ms": "1500" }), name: "retry-after-ms" },
  { delay: 60_000, headers: () => ({ "retry-after": "60" }), name: "retry-after seconds" },
  {
    delay: 45_000,
    headers: () => ({
      "retry-after": DateTime.toDateUtc(
        DateTime.makeUnsafe(currentTimeMillis() + 45_000),
      ).toUTCString(),
    }),
    name: "retry-after HTTP date",
  },
];

const honorsRetryHeader = ({ delay, headers }: (typeof retryHeaderCases)[number]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers();
      vi.setSystemTime("2026-05-13T00:00:00Z");
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const { requests } = failFirst(1, headers);
      const pending = startCodex({ maxRetries: 1 });
      yield* advance(0);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), delay);
      yield* nextTimer;
      const message = yield* Effect.promise(() => pending);
      expect(message.content.find((content) => content.type === "text")?.text).toBe("Hello");
      expect(requests).toHaveLength(2);
    }),
  );

const failsWhenDelayExceedsLimit = (status: number) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { fetchMock } = stubCodexFetch(() => rateLimited({ "retry-after": "2" }, status));
      const result = yield* runCodex({ maxRetries: 3, maxRetryDelayMs: 1000 });
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toBe("Server requested 2s retry delay (max: 1s)");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }),
  );

const backsOffExponentially = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers();
      vi.setSystemTime("2026-05-13T00:00:00Z");
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const { requests } = failFirst(3, () => ({}));
      const retryDelays = () =>
        setTimeoutSpy.mock.calls
          .map((call) => call[1])
          .filter((delay) => delay === 1000 || delay === 2000 || delay === 4000);
      const pending = startCodex({ maxRetries: 3 });
      yield* advance(0);
      expect(retryDelays()).toEqual([1000]);
      yield* nextTimer;
      expect(retryDelays()).toEqual([1000, 2000]);
      yield* nextTimer;
      expect(retryDelays()).toEqual([1000, 2000, 4000]);
      yield* nextTimer;
      const message = yield* Effect.promise(() => pending);
      expect(message.content.find((content) => content.type === "text")?.text).toBe("Hello");
      expect(requests).toHaveLength(4);
    }),
  );

describe("openai-codex SSE retries", () => {
  resetCodexStateAfterEach();

  it.for(retryHeaderCases)("uses $name for SSE retries", honorsRetryHeader);
  it.for([429, 503])(
    "fails immediately when a %i retry delay exceeds the limit",
    failsWhenDelayExceedsLimit,
  );
  it(
    "uses exponential backoff across repeated SSE retries without retry headers",
    backsOffExponentially,
  );
});
