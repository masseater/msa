import { fauxAssistantMessage, fauxToolCall } from "@msa/ai/compat";
import { describe, expect, it } from "vitest";

import { MEMORY_RECALL_MESSAGE_TYPE } from "../../src/core/memory/memory.ts";
import { MemoryStore } from "../../src/core/memory/store.ts";
import { createHarness, getToolResult, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];

async function createMemoryHarness(): Promise<Harness> {
  const harness = await createHarness();
  harnesses.push(harness);
  return harness;
}

describe("agent session memory", () => {
  it("saves through the memory tool and recalls the memory in a later run", async () => {
    const harness = await createMemoryHarness();
    expect(harness.session.getActiveToolNames()).toContain("memory");

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
    await harness.session.prompt("remember how releases are published");
    const saved = getToolResult(harness, "memory");
    expect(saved.content[0]).toMatchObject({ type: "text" });
    expect(saved.content[0]?.type === "text" ? saved.content[0].text : "").toContain(
      "Saved memory",
    );

    harness.setResponses([fauxAssistantMessage("the tap")]);
    await harness.session.prompt("how does the release work?");
    const recall = harness.session.messages.find(
      (message) => message.role === "custom" && message.customType === MEMORY_RECALL_MESSAGE_TYPE,
    );
    expect(recall).toBeDefined();
    expect(recall?.role === "custom" ? recall.display : true).toBe(false);
    expect(
      recall?.role === "custom" && typeof recall.content === "string" ? recall.content : "",
    ).toContain("Homebrew tap");
  });

  it("answers /memory with status, stats, list, and search", async () => {
    const harness = await createMemoryHarness();
    harness.setResponses([fauxAssistantMessage("ok")]);
    await harness.session.prompt("/memory");
    let status = harness.eventsOfType("memory_status").at(-1);
    expect(status?.text).toContain("Memory is enabled.");
    expect(status?.text).toContain("/memory list");

    harness.setResponses([fauxAssistantMessage("ok")]);
    await harness.session.prompt("/memory stats");
    status = harness.eventsOfType("memory_status").at(-1);
    expect(status?.text).toContain("Total: 0");

    harness.setResponses([fauxAssistantMessage("ok")]);
    await harness.session.prompt("/memory list");
    status = harness.eventsOfType("memory_status").at(-1);
    expect(status?.text).toBe("No memories stored yet.");

    harness.setResponses([fauxAssistantMessage("ok")]);
    await harness.session.prompt("/memory search nothing");
    status = harness.eventsOfType("memory_status").at(-1);
    expect(status?.text).toBe("No matching memories.");
  });

  it("injects recalled memories for the first prompt of a session", async () => {
    const harness = await createMemoryHarness();
    const store = new MemoryStore(harness.settingsManager.getMemorySettings().database);
    store.save({
      content: "the release goes to the Homebrew tap",
      kind: "fact",
      scope: "project",
      project: harness.tempDir.split("/").pop() ?? "",
    });
    store.close();

    harness.setResponses([fauxAssistantMessage("ok")]);
    await harness.session.prompt("explain the release process");
    const recall = harness.session.messages.find(
      (message) => message.role === "custom" && message.customType === MEMORY_RECALL_MESSAGE_TYPE,
    );
    expect(recall).toBeDefined();

    harness.setResponses([fauxAssistantMessage("ok")]);
    await harness.session.prompt("unrelated question about weather");
    const recalls = harness.session.messages.filter(
      (message) => message.role === "custom" && message.customType === MEMORY_RECALL_MESSAGE_TYPE,
    );
    expect(recalls).toHaveLength(1);
  });
});
