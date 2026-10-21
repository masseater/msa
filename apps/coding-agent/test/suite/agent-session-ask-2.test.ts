import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import agentSessionAskSupport from "./agent-session-ask-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } = ai;

const { awaited, gate, runTest, toJsonText } = testing;

const { getUserTexts } = harnessModule;

const { cleanupHarnesses, declared, record, setup } = agentSessionAskSupport;

const givesACallToAToolThat = () =>
  runTest(
    Effect.gen(function* () {
      const { harness, ran } = yield* setup();
      record(harness, [
        fauxAssistantMessage([fauxToolCall("deploy", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage("I cannot deploy in an ask."),
      ]);

      yield* awaited(harness.session.run.prompting.prompt("/ask deploy it"));

      expect(ran).toEqual([]);
      const result = harness.session.messages.findLast((message) => message.role === "toolResult");
      expect(result).toMatchObject({ isError: true, toolName: "deploy" });
    }),
  );

const refusesAWriteActionOnATool = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();
      const requests = record(harness, [
        fauxAssistantMessage([fauxToolCall("memory", { action: "save", content: "x" })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage([fauxToolCall("memory", { action: "list" })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("listed"),
      ]);

      yield* awaited(harness.session.run.prompting.prompt("/ask remember x"));

      const results = harness.session.messages.filter((message) => message.role === "toolResult");
      expect(results.map((result) => result.isError)).toEqual([true, false]);
      expect(yield* toJsonText(results[1]?.content)).toContain("No memories");
      expect(requests).toHaveLength(3);
      for (const request of requests) {
        expect(getCurrentSystemPrompt(request.messages)).not.toContain("save durable facts");
        expect(getCurrentSystemPrompt(request.messages)).toContain("- memory: Search and list");
      }
    }),
  );

const isTheSameTurnFromTheSdk = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();
      const requests = record(harness, [fauxAssistantMessage("answer")]);

      yield* awaited(
        harness.session.run.prompting.prompt("can you fix the build?", { mode: "ask" }),
      );

      expect(declared(requests[0])).not.toContain("bash");
      expect(declared(requests[0])).toContain("read");
      expect(getUserTexts(harness)).toEqual(["can you fix the build?"]);
    }),
  );

const needsAQuestion = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();

      yield* awaited(
        expect(harness.session.run.prompting.prompt("/ask")).rejects.toThrow(
          "Usage: /ask <question>",
        ),
      );
      expect(harness.session.messages).toEqual([]);
    }),
  );

const isNotQueuedIntoARunningTurn = () =>
  runTest(
    Effect.gen(function* () {
      const { harness } = yield* setup();
      const firstTurn = gate();
      record(harness, [
        () =>
          runTest(
            Effect.gen(function* () {
              yield* awaited(firstTurn);
              return fauxAssistantMessage("first");
            }),
          ),
      ]);

      const running = harness.session.run.prompting.prompt("work");
      yield* awaited(
        expect(
          harness.session.run.prompting.prompt("/ask what now?", { streamingBehavior: "steer" }),
        ).rejects.toThrow("Cannot ask while the agent is running"),
      );
      firstTurn.release();
      yield* awaited(running);
    }),
  );

describe("/ask", () => {
  afterEach(cleanupHarnesses);

  it(
    "gives a call to a tool that is not declared an error and does not run it",
    givesACallToAToolThat,
  );

  it("refuses a write action on a tool that also reads", refusesAWriteActionOnATool);

  it("is the same turn from the SDK as `mode: ask`", isTheSameTurnFromTheSdk);

  it("needs a question", needsAQuestion);

  it("is not queued into a running turn", isNotQueuedIntoARunningTurn);
});
