import { arch, platform } from "node:os";

import { Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiCodexResponses from "../src/api/openai-codex-responses.ts";
import type typesModule from "../src/types.types.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { stream: streamOpenAICodexResponses } = openaiCodexResponses;

const {
  codexModel,
  collectEvents,
  completedSse,
  mockToken,
  openSseBody,
  promptContext,
  resetCodexStateAfterEach,
  runCodex,
  helloEvents,
  sseResponse,
  sseText,
  stubCodexFetch,
} = openaiCodexStreamSupport;

const streamsAndForwardsRawEvents = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const token = mockToken();
      const { requests } = stubCodexFetch();
      const model = codexModel();
      const providerEvents: Array<{ event: unknown; model: typesModule.Model<typesModule.Api> }> =
        [];
      const { events, result } = yield* collectEvents(
        streamOpenAICodexResponses(model, promptContext(), {
          apiKey: token,
          onProviderStreamEvent: (event, eventModel) => {
            providerEvents.push({ event, model: eventModel });
          },
          transport: "sse",
        }),
      );

      expect(events.some((event) => event.type === "text_delta")).toBe(true);
      expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
      expect(providerEvents.map(({ event }) => (event as { type?: string }).type)).toEqual([
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.output_item.done",
        "response.completed",
      ]);
      expect(providerEvents.every((entry) => entry.model === model)).toBe(true);
      const headers = requests[0]?.headers;
      expect(headers?.get("Authorization")).toBe(`Bearer ${token}`);
      expect(headers?.get("chatgpt-account-id")).toBe("acc_test");
      expect(headers?.get("OpenAI-Beta")).toBe("responses=experimental");
      expect(headers?.get("originator")).toBe("pi");
      expect(headers?.get("User-Agent")).toBe(`pi (${platform()}; ${arch()})`);
      expect(headers?.get("accept")).toBe("text/event-stream");
      expect(headers?.has("x-api-key")).toBe(false);
    }),
  );

const finishesWithoutTrailingBlankLine = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const body = completedSse().trimEnd();
      const result = yield* runCodex({ fetch: () => Promise.resolve(sseResponse(body)) });
      expect(result.stopReason).toBe("stop");
      expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
    }),
  );

const finishesWhileBodyStaysOpen = (status: "completed" | "incomplete", stopReason: string) => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      stubCodexFetch(() =>
        sseResponse(
          openSseBody(
            completedSse({ endTurn: false, includeDone: status === "completed", status }),
          ),
        ),
      );
      const result = yield* runCodex({}).pipe(Effect.timeout("1 second"), Effect.orDie);
      expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
      expect(result.stopReason).toBe(stopReason);
    }),
  );

const hangUntilAborted = (_input: string | URL | Request, init?: RequestInit) => {
  const signal = init?.signal;
  if (signal === undefined || signal === null) {
    return Promise.reject(new Error("Expected SSE fetch to receive an abort signal"));
  }
  return Effect.runPromise(Effect.never, { signal });
};

const timesOutWaitingForHeaders = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fetchMock = vi.fn(hangUntilAborted);
      const result = yield* runCodex({ fetch: fetchMock, timeoutMs: 10 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toBe("Codex SSE response headers timed out after 10ms");
    }),
  );

const slowBody = (cancelled: { value: boolean }) =>
  Stream.toReadableStream(
    Stream.make(
      sseText([
        ...helloEvents({}).slice(0, 2),
        { delta: "one", type: "response.output_text.delta" },
      ]),
    ).pipe(
      Stream.concat(
        Stream.fromEffect(
          Effect.as(
            Effect.sleep(10),
            sseText([{ delta: "two", type: "response.output_text.delta" }]),
          ),
        ),
      ),
      Stream.concat(Stream.fromEffect(Effect.as(Effect.sleep(10), completedSse()))),
      Stream.encodeText,
      Stream.ensuring(Effect.sync(() => (cancelled.value = true))),
    ),
  );

const abortsBodyReadsAfterHeaders = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const cancelled = { value: false };
      stubCodexFetch(() => sseResponse(slowBody(cancelled)));
      const { events, result } = yield* collectEvents(
        streamOpenAICodexResponses(codexModel(), promptContext(), {
          apiKey: mockToken(),
          signal: controller.signal,
          transport: "sse",
        }),
        (event) => {
          if (event.type === "text_delta" && event.delta === "one") controller.abort();
        },
      );
      const deltas = events.flatMap((event) => (event.type === "text_delta" ? [event.delta] : []));
      expect(result.stopReason).toBe("aborted");
      expect(result.errorMessage).toBe("Request was aborted");
      expect(deltas).toEqual(["one"]);
      expect(cancelled.value).toBe(true);
    }),
  );
};

describe("openai-codex streaming over SSE", () => {
  resetCodexStateAfterEach();

  it("streams SSE responses and forwards raw provider events", streamsAndForwardsRawEvents);
  it(
    "processes a terminal SSE event without a trailing blank line",
    finishesWithoutTrailingBlankLine,
  );
  it(
    "completes after response.completed even when the SSE body stays open",
    finishesWhileBodyStaysOpen("completed", "stop"),
  );
  it(
    "maps response.incomplete to stopReason length even when the SSE body stays open",
    finishesWhileBodyStaysOpen("incomplete", "length"),
  );
  it(
    "aborts SSE fetch after the configured HTTP timeout when response headers do not arrive",
    timesOutWaitingForHeaders,
  );
  it("aborts SSE body reads after response headers arrive", abortsBodyReadsAfterHeaders);
});
