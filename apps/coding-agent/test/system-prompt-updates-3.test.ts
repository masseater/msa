import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, test } from "vite-plus/test";

import harnessModule from "./suite/harness.ts";

const { fauxAssistantMessage } = ai;

const { createHarness } = harnessModule;

const { awaited, fromJsonText, runTest, toJsonText } = testing;

const keepsToolDeclarationsStableAcrossASession = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const executableTool: agentTypes.AgentTool = {
        description: "Plain tool",
        execute: () => effectRunPromise(awaited({ content: [], details: {} })),
        label: "Plain",
        name: "plain",
        parameters: Type.Object({}),
      };
      const harness = yield* awaited(
        createHarness({
          initialActiveToolNames: ["plain"],
          tools: [executableTool],
        }),
      );
      try {
        harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
        yield* awaited(harness.session.run.prompting.prompt("one"));
        const head = harness.session.messages[0];
        if (head?.role !== "system") throw new Error("expected system message");
        const declaration = head.toolsAdded?.[0];
        if (!(declaration !== undefined)) throw new Error("expected tool declaration");
        expect(Object.hasOwn(declaration, "constrainedSampling")).toBe(false);
        expect(Object.hasOwn(declaration, "execute")).toBe(false);

        harness.session.agent.state.messages = (yield* fromJsonText(
          yield* toJsonText(harness.session.messages),
        )) as agentTypes.AgentMessage[];
        yield* awaited(harness.session.run.prompting.prompt("two"));
        expect(
          harness.session.messages.filter((message) => message.role === "system"),
        ).toHaveLength(1);
      } finally {
        harness.cleanup();
      }
    }),
  );

describe("system prompt updates", () => {
  test(
    "keeps tool declarations stable across a session JSON round-trip",
    keepsToolDeclarationsStableAcrossASession,
  );
});
