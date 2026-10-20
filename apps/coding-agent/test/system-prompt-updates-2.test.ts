import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, test } from "vite-plus/test";

import type srcTypes from "../src/index.types.ts";
import harnessModule from "./suite/harness.ts";

const {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getSystemMessageText,
} = ai;

const { createHarness } = harnessModule;

const { awaited, runTest } = testing;

const aForcedPromptIsSentAsThePart1 = () =>
  Effect.gen(function* () {
    let turn = 0;
    const extension: srcTypes.ExtensionFactory = (msa) => {
      msa.on("before_agent_start", (event) => {
        if (++turn === 3) event.systemPromptOptions.sections["plan_mode"] = "Plan only.";
        return turn === 2 || turn === 3 ? { systemPrompt: "Exact prompt." } : undefined;
      });
    };
    const harness = yield* awaited(createHarness({ extensionFactories: [extension] }));
    return { harness };
  });

const aForcedPromptIsSentAsThe = Effect.gen(function* () {
  const { harness } = yield* aForcedPromptIsSentAsThePart1();
  try {
    const requests: aiTypes.TranscriptContext[] = aForcedPromptIsSentAsThePart2(harness);
    for (const text of ["one", "two", "three", "four"])
      yield* awaited(harness.session.prompt(text));
    const systemMessages = requests.map((request) =>
      request.messages.filter((message) => message.role === "system"),
    );

    expect(systemMessages.map((messages) => messages.length)).toEqual([1, 1, 1, 3]);

    const forced = systemMessages[1]?.at(-1);
    expect(forced).toEqual({
      content: "Exact prompt.",
      role: "system",
      timestamp: systemMessages[0]?.[0]?.timestamp,
      toolsAdded: systemMessages[0]?.[0]?.toolsAdded,
    });
    expect(systemMessages[2]?.at(-1)).toEqual(forced);
    expect(getCurrentSystemPrompt(requests[2]!.messages)).toBe("Exact prompt.");
    expect(requests[2]!.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);

    const recorded = harness.session.messages.flatMap((message) =>
      message.role === "system" ? [message.sections] : [],
    );
    expect(recorded).toEqual([
      systemMessages[0]?.[0]?.sections,
      { plan_mode: "<plan_mode>\nPlan only.\n</plan_mode>" },
      { plan_mode: null },
    ]);
    expect(getCurrentSystemPrompt(harness.session.messages)).toBe(harness.session.systemPrompt);
  } finally {
    harness.cleanup();
  }
});

const promptedToolsExtension: srcTypes.ExtensionFactory = (msa) => {
  for (const name of ["first", "second"]) {
    msa.registerTool({
      description: `${name} description`,
      execute: () =>
        Promise.resolve({ content: [{ text: name, type: "text" as const }], details: {} }),
      label: name,
      name,
      parameters: Type.Object({}),
      promptGuidelines: [`Use ${name} carefully.`],
      promptSnippet: `${name} prompt snippet`,
    });
  }
};

const recordRequests = (
  requests: aiTypes.TranscriptContext[],
  replies: ReadonlyArray<ReturnType<typeof fauxAssistantMessage>>,
) =>
  replies.map((reply) => (providerContext: aiTypes.TranscriptContext) => {
    requests.push(providerContext);
    return reply;
  });

const expectInitialSystemMessage = (request: aiTypes.TranscriptContext | undefined) => {
  expect(Object.keys(request ?? {})).toEqual(["messages"]);
  const initial = request?.messages[0];
  if (initial?.role !== "system") throw new Error("expected initial system message");
  expect(initial.toolsAdded?.map((value) => value.name)).toEqual(["first", "second"]);
  expect(initial.sections?.["tools"]).toContain("first prompt snippet");
};

const setactivetoolsEmitsPromptSectionsAndToolChanges = Effect.gen(function* () {
  const harness = yield* awaited(
    createHarness({
      extensionFactories: [promptedToolsExtension],
      initialActiveToolNames: ["first"],
    }),
  );
  try {
    const requests: aiTypes.TranscriptContext[] = [];
    harness.setResponses(
      recordRequests(requests, [
        fauxAssistantMessage("first"),
        fauxAssistantMessage([fauxToolCall("first", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage("second"),
      ]),
    );
    yield* awaited(harness.session.prompt("first"));
    harness.session.setActiveToolsByName(["second"]);
    yield* awaited(harness.session.prompt("second"));
    expect(requests).toHaveLength(3);

    expectInitialSystemMessage(requests[0]);

    const update = requests[1]?.messages.filter((message) => message.role === "system").at(-1);
    expect(update).toEqual({
      content: "",
      role: "system",
      sections: {
        rules: expect.any(String),
        tools: expect.stringContaining("second prompt snippet"),
      },
      timestamp: expect.any(Number),
      toolsRemoved: [{ name: "first" }],
    });
    expect(update?.sections?.["tools"]).not.toContain("first prompt snippet");
    expect(update?.sections?.["rules"]).not.toContain("Use first carefully.");

    const result = requests[2]?.messages.filter((message) => message.role === "toolResult").at(-1);
    expect(result).toMatchObject({ isError: true, role: "toolResult", toolName: "first" });

    const current = getCurrentSystemMessage(harness.session.messages);
    expect(current?.toolsAdded?.map((value) => value.name)).toEqual(["second"]);
    expect(getSystemMessageText(current!)).toBe(harness.session.systemPrompt);
  } finally {
    harness.cleanup();
  }
});

const setactivetoolsInBeforeAgentStartControlsThe = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const extension: srcTypes.ExtensionFactory = (msa) => {
    for (const name of ["first", "second"]) {
      msa.registerTool({
        description: `${name} description`,
        execute: () =>
          effectRunPromise(
            awaited({ content: [{ text: name, type: "text" as const }], details: {} }),
          ),
        label: name,
        name,
        parameters: Type.Object({}),
      });
    }
    let turn = 0;
    msa.on("before_agent_start", () => {
      if (turn++ === 1) msa.setActiveTools(["second"]);
    });
  };
  const harness = yield* awaited(
    createHarness({
      extensionFactories: [extension],
      initialActiveToolNames: ["first"],
    }),
  );
  try {
    const requests: aiTypes.TranscriptContext[] = [];
    harness.setResponses([
      (providerContext) => {
        requests.push(providerContext);
        return fauxAssistantMessage("first");
      },
      (providerContext) => {
        requests.push(providerContext);
        return fauxAssistantMessage("second");
      },
    ]);
    yield* awaited(harness.session.prompt("first"));
    yield* awaited(harness.session.prompt("second"));
    expect(requests).toHaveLength(2);
    const update = requests[1]?.messages.filter((message) => message.role === "system").at(-1);
    expect(update?.toolsRemoved).toEqual([{ name: "first" }]);
    expect(update?.toolsAdded).toBeUndefined();
    expect(harness.session.getActiveToolNames()).toEqual(["second"]);
  } finally {
    harness.cleanup();
  }
});

describe("system prompt updates", () => {
  test("a forced prompt is sent as the leading prompt for the run and never recorded", () =>
    runTest(aForcedPromptIsSentAsThe));

  test("setActiveTools emits prompt sections and tool changes before the next request", () =>
    runTest(setactivetoolsEmitsPromptSectionsAndToolChanges));

  test("setActiveTools in before_agent_start controls the same request", () =>
    runTest(setactivetoolsInBeforeAgentStartControlsThe));
});

function aForcedPromptIsSentAsThePart2(harness: any) {
  const requests: aiTypes.TranscriptContext[] = [];
  harness.setResponses(
    ["one", "two", "three", "four"].map((text) => (providerContext: aiTypes.TranscriptContext) => {
      requests.push(providerContext);
      return fauxAssistantMessage(text);
    }),
  );
  return requests;
}
