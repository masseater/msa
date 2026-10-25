import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import jsonEvent from "../../../src/modes/json-event.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { toJsonEvent } = jsonEvent;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness } = harnessModule;

let harness!: harnessTypes.Harness;

const includesTheToolCallIdAnd = Effect.gen(function* () {
  harness = yield* Effect.promise(() => createHarness());
  harness.setResponses([
    fauxAssistantMessage(
      fauxToolCall("write", { content: "x".repeat(100), path: "output.txt" }, { id: "call_7925" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("write a file"));

  const update = harness
    .eventsOfType("message_update")
    .find((event) => event.assistantMessageEvent.type === "toolcall_start");
  if (update === undefined || update.message.role !== "assistant") {
    throw new Error("Expected toolcall_start assistant update");
  }

  expect(toJsonEvent(update)).toEqual({
    assistantMessageEvent: {
      contentIndex: 0,
      id: "call_7925",
      toolName: "write",
      type: "toolcall_start",
    },
    type: "message_update",
    usage: update.message.usage,
  });
});

const includesTheToolCallIdAndName = () => Effect.runPromise(includesTheToolCallIdAnd);

describe("regression #7925: tool-call metadata is available when streaming starts", () => {
  afterEach(() => harness?.cleanup());
  it(
    "includes the tool call id and name without cumulative snapshots",
    includesTheToolCallIdAndName,
  );
});
