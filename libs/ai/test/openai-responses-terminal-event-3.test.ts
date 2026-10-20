import { Effect, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiResponsesStream from "../src/api/openai-responses-stream.ts";
import type typesModule from "../src/types.types.ts";
import eventStream from "../src/utils/event-stream.ts";
import openaiResponsesTerminalEventSupport from "./openai-responses-terminal-event-support.ts";

const { AssistantMessageEventStream } = eventStream;
const { processResponsesStream } = openaiResponsesStream;

const { createModel, createOutput } = openaiResponsesTerminalEventSupport;

vi.mock("openai", () =>
  import("./openai-responses-terminal-event-mock.ts").then((module) => module.default),
);

type Phase = "commentary" | "final_answer";

const phaseMessage = (phase: Phase, done: boolean) => ({
  content: done ? [{ annotations: [], text: "answer", type: "output_text" }] : [],
  id: "msg_phase",
  phase,
  role: "assistant",
  status: done ? "completed" : "in_progress",
  type: "message",
});

const terminalEvent = (terminalStatus: "completed" | "incomplete") =>
  terminalStatus === "incomplete"
    ? {
        response: {
          id: "resp_phase",
          incomplete_details: { reason: "max_output_tokens" },
          status: "incomplete",
        },
        sequence_number: 2,
        type: "response.incomplete",
      }
    : {
        response: { id: "resp_phase", status: "completed" },
        sequence_number: 2,
        type: "response.completed",
      };

function createPhasedMessageEvents(
  phases: readonly [Phase, Phase],
  terminalStatus: "completed" | "incomplete" = "completed",
): AsyncIterable<ResponseStreamEvent> {
  const events = [
    {
      item: phaseMessage(phases[0], false),
      output_index: 0,
      sequence_number: 0,
      type: "response.output_item.added",
    },
    {
      item: phaseMessage(phases[1], true),
      output_index: 0,
      sequence_number: 1,
      type: "response.output_item.done",
    },
    terminalEvent(terminalStatus),
  ] as ResponseStreamEvent[];
  return Stream.toAsyncIterable(Stream.fromIterable(events));
}

describe("OpenAI Responses terminal event handling", () => {
  it.each([
    { expected: ["pending", "pending"], phases: ["commentary", "commentary"] },
    { expected: ["stop", "stop"], phases: ["final_answer", "final_answer"] },
    { expected: ["pending", "stop"], phases: ["commentary", "final_answer"] },
  ] as const)("tracks message phases $phases", ({ phases, expected }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel();
        const output = createOutput(model);
        const stream = new AssistantMessageEventStream();
        const observedStopReasons: typesModule.AssistantMessage["stopReason"][] = [];
        const push = stream.push.bind(stream);
        stream.push = (event) => {
          if ("partial" in event) observedStopReasons.push(event.partial.stopReason);
          push(event);
        };

        yield* processResponsesStream(createPhasedMessageEvents(phases), output, stream, model);

        expect(observedStopReasons).toEqual(expected);
        expect(output.stopReason).toBe("stop");
      }),
    ),
  );
});

const replacesAProvisionalFinalAnswerStop = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();
      const output = createOutput(model);
      const stream = new AssistantMessageEventStream();
      const observedStopReasons: typesModule.AssistantMessage["stopReason"][] = [];
      const push = stream.push.bind(stream);
      stream.push = (event) => {
        if ("partial" in event) observedStopReasons.push(event.partial.stopReason);
        push(event);
      };

      yield* processResponsesStream(
        createPhasedMessageEvents(["final_answer", "final_answer"], "incomplete"),
        output,
        stream,
        model,
      );

      expect(observedStopReasons).toEqual(["stop", "stop"]);
      expect(output.stopReason).toBe("length");
    }),
  );

describe("OpenAI Responses terminal event handling", () => {
  it(
    "replaces a provisional final-answer stop with an incomplete terminal reason",
    replacesAProvisionalFinalAnswerStop,
  );
});
