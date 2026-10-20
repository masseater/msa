import compat from "@msa/ai/compat";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import MemoryStore from "../../src/core/memory/memory-store.ts";
import memory from "../../src/core/memory/memory.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { MEMORY_RECALL_MESSAGE_TYPE } = memory;
const { fauxAssistantMessage, fauxToolCall } = compat;

const { createHarness, getToolResult } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

function createMemoryHarness(): Promise<harnessTypes.Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());
      harnesses.push(harness);
      return harness;
    }),
  );
}

const savesThroughTheMemoryToolAnd = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createMemoryHarness());
  expect(harness.session.tools.loadout.getActiveToolNames()).toContain("memory");

  harness.setResponses([
    fauxAssistantMessage(
      fauxToolCall("memory", {
        action: "save",
        content: "the release goes to the Homebrew tap",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved"),
  ]);
  yield* Effect.promise(() =>
    harness.session.run.prompting.prompt("remember how releases are published"),
  );
  const saved = getToolResult(harness, "memory");
  expect(saved.content[0]).toMatchObject({ type: "text" });
  expect(saved.content[0]?.type === "text" ? saved.content[0].text : "").toContain("Saved memory");

  harness.setResponses([fauxAssistantMessage("the tap")]);
  yield* Effect.promise(() =>
    harness.session.run.prompting.prompt("the release goes to the Homebrew tap?"),
  );
  const recall = harness.session.messages.find(
    (message) => message.role === "custom" && message.customType === MEMORY_RECALL_MESSAGE_TYPE,
  );
  expect(recall).toBeDefined();
  expect(recall?.role === "custom" ? recall.display : true).toBe(false);
  expect(
    recall?.role === "custom" && typeof recall.content === "string" ? recall.content : "",
  ).toContain("Homebrew tap");
});

const answersMemoryWithStatusStatsList = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createMemoryHarness());
  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/memory"));
  let status = harness.eventsOfType("memory_status").at(-1);
  expect(status?.text).toContain("Memory is enabled.");
  expect(status?.text).toContain("/memory list");

  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/memory stats"));
  status = harness.eventsOfType("memory_status").at(-1);
  expect(status?.text).toContain("Total: 0");

  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/memory list"));
  status = harness.eventsOfType("memory_status").at(-1);
  expect(status?.text).toBe("No memories stored yet.");

  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("/memory search nothing"));
  status = harness.eventsOfType("memory_status").at(-1);
  expect(status?.text).toBe("No matching memories.");
});

const injectsRecalledMemoriesForTheFirst = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createMemoryHarness());
  const store = new MemoryStore(harness.settingsManager.getMemorySettings().database);
  store.save({
    content: "the release goes to the Homebrew tap",
    kind: "fact",
    project: harness.tempDir.split("/").pop() ?? "",
    scope: "project",
  });
  store.close();

  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() =>
    harness.session.run.prompting.prompt("the release goes to the Homebrew tap?"),
  );
  const recall = harness.session.messages.find(
    (message) => message.role === "custom" && message.customType === MEMORY_RECALL_MESSAGE_TYPE,
  );
  expect(recall).toBeDefined();

  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() =>
    harness.session.run.prompting.prompt("unrelated question about weather"),
  );
  const recalls = harness.session.messages.filter(
    (message) => message.role === "custom" && message.customType === MEMORY_RECALL_MESSAGE_TYPE,
  );
  expect(recalls).toHaveLength(1);
});

const savesThroughTheMemoryToolAndRecalls = () => Effect.runPromise(savesThroughTheMemoryToolAnd);

const answersMemoryWithStatusStatsListAnd = () =>
  Effect.runPromise(answersMemoryWithStatusStatsList);

const injectsRecalledMemoriesForTheFirstPrompt = () =>
  Effect.runPromise(injectsRecalledMemoriesForTheFirst);

describe("agent session memory", () => {
  it(
    "saves through the memory tool and recalls the memory in a later run",
    savesThroughTheMemoryToolAndRecalls,
  );
  it("answers /memory with status, stats, list, and search", answersMemoryWithStatusStatsListAnd);
  it(
    "injects recalled memories for the first prompt of a session",
    injectsRecalledMemoriesForTheFirstPrompt,
  );
});
