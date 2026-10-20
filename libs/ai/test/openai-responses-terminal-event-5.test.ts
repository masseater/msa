import { Effect, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiResponsesStream from "../src/api/openai-responses-stream.ts";
import eventStream from "../src/utils/event-stream.ts";
import effectAssert from "./effect-assert.ts";
import openaiResponsesTerminalEventSupport from "./openai-responses-terminal-event-support.ts";

const { AssistantMessageEventStream } = eventStream;
const { processResponsesStream } = openaiResponsesStream;

const { createModel, createOutput } = openaiResponsesTerminalEventSupport;

vi.mock("openai", () =>
  import("./openai-responses-terminal-event-mock.ts").then((module) => module.default),
);

const { expectDefect } = effectAssert;

function createFailedEvents(): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          response: {
            error: { code: "server_error", message: "boom" },
            id: "resp_failed",
            status: "failed",
          },
          sequence_number: 0,
          type: "response.failed",
        } as ResponseStreamEvent;
      })(),
    ),
  );
}

const rejectsFailedTerminalEventsWithThe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();
      const output = createOutput(model);
      const stream = new AssistantMessageEventStream();

      yield* expectDefect(
        processResponsesStream(createFailedEvents(), output, stream, model),
        "server_error: boom",
      );
      expect(output.rawStopReason).toBe("failed");
    }),
  );

describe("OpenAI Responses terminal event handling", () => {
  it("rejects failed terminal events with the provider error", rejectsFailedTerminalEventsWithThe);
});
