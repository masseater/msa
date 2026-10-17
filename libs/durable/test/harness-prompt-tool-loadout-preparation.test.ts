import { type SystemMessage, type Tool, Type } from "@msa/ai";
import { getCurrentTools, toToolDeclaration } from "@msa/ai/utils/transcript";
import { type Conversation, SystemEntry } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { planSystemEntries } from "../src/harness/prompt.ts";
import { marker, root } from "./harness-prompt-support.ts";
import { context } from "./session-support.ts";

const declaration = (name: string, description = name): Tool => ({
  name,
  description,
  parameters: Type.Object({}),
});

// Plan tools only, append the plan, check that replay offers `tools` in order, and return each message's changes.
async function applyTools(
  conversation: Conversation,
  tools: readonly Tool[],
  sections: Record<string, string> = {},
): Promise<{ removed?: string[]; added?: string[]; sections?: Record<string, string | null> }[]> {
  const drafts = planSystemEntries(
    await conversation.context(context),
    new Map(Object.entries(sections)),
    tools,
    7,
  );
  await conversation.commit(async (tx) => {
    for await (const draft of drafts) await tx.appendEntry(SystemEntry, conversation.id, draft);
  }, context);
  const offered = getCurrentTools((await conversation.context(context)).messages);
  expect(offered).toEqual(tools.map(toToolDeclaration));
  return drafts.map((draft) => {
    const message = draft.model![0] as SystemMessage;
    const changes: {
      removed?: string[];
      added?: string[];
      sections?: SystemMessage["sections"];
    } = {};
    if (message.toolsRemoved !== undefined)
      changes.removed = message.toolsRemoved.map((tool) => tool.name);
    if (message.toolsAdded !== undefined)
      changes.added = message.toolsAdded.map((tool) => tool.name);
    if (message.sections !== undefined) changes.sections = message.sections;
    return changes;
  });
}

describe("tool loadout preparation", () => {
  it("adds, removes, replaces changed declarations, and rewrites the order when needed", async () => {
    const conversation = await root();
    const [a, b, c] = [declaration("a"), declaration("b"), declaration("c")];
    expect(await applyTools(conversation, [a, b])).toEqual([{ added: ["a", "b"] }]);
    expect(await applyTools(conversation, [a, b])).toEqual([]);
    expect(await applyTools(conversation, [a, b, c])).toEqual([{ added: ["c"] }]);
    expect(await applyTools(conversation, [a, c])).toEqual([{ removed: ["b"] }]);
    // A changed declaration at the end is removed and re-added in place.
    const c2 = declaration("c", "changed");
    expect(await applyTools(conversation, [a, c2])).toEqual([{ removed: ["c"], added: ["c"] }]);
    // A changed declaration in the middle would move to the end, so the whole order is rewritten.
    const a2 = declaration("a", "changed");
    expect(await applyTools(conversation, [a2, c2])).toEqual([
      { removed: ["a", "c"], added: ["a", "c"] },
    ]);
    // Order-only change.
    expect(await applyTools(conversation, [c2, a2])).toEqual([
      { removed: ["a", "c"], added: ["c", "a"] },
    ]);
    expect(await applyTools(conversation, [])).toEqual([{ removed: ["c", "a"] }]);
  });

  it("puts tool changes on the last section entry and re-declares every tool after a head cut", async () => {
    const conversation = await root();
    const [a, b] = [declaration("a"), declaration("b")];
    expect(await applyTools(conversation, [a], { x: "1", y: "2" })).toEqual([
      { added: ["a"], sections: { x: "1", y: "2" } },
    ]);
    // Section order changes need two entries; the tool change rides on the second.
    expect(await applyTools(conversation, [a, b], { y: "2", x: "1" })).toEqual([
      { sections: { x: null, y: null } },
      { added: ["b"], sections: { y: "2", x: "1" } },
    ]);
    await marker(conversation, "self");
    expect(await applyTools(conversation, [a, b], { y: "2", x: "1" })).toEqual([
      { added: ["a", "b"], sections: { y: "2", x: "1" } },
    ]);
  });
});
