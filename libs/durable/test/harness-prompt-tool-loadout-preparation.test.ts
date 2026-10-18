import { type SystemMessage, type Tool, Type } from "@msa/ai";
import { getCurrentTools, toToolDeclaration } from "@msa/ai/utils/transcript";
import { type Conversation, SystemEntry } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { planSystemEntries } from "../src/harness/prompt.ts";
import { awaited } from "./effect-support.ts";
import { marker, root } from "./harness-prompt-support.ts";
import { context } from "./session-support.ts";

const declaration = (name: string, description = name): Tool => ({
  name,
  description,
  parameters: Type.Object({}),
});

const applyTools = Effect.fn("applyTools")(function* (
  conversation: Conversation,
  tools: readonly Tool[],
  sections: Record<string, string> = {},
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const drafts = planSystemEntries(
    yield* awaited(conversation.context(context)),
    new Map(Object.entries(sections)),
    tools,
    7,
  );
  yield* awaited(
    conversation.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            for (const draft of drafts)
              yield* awaited(tx.appendEntry(SystemEntry, conversation.id, draft));
          }),
        ),
      context,
    ),
  );
  const offered = getCurrentTools((yield* awaited(conversation.context(context))).messages);
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
});

const addsRemovesReplaces = Effect.gen(function* () {
  const conversation = yield* root();
  const [a, b, c] = [declaration("a"), declaration("b"), declaration("c")];
  expect(yield* applyTools(conversation, [a, b])).toEqual([{ added: ["a", "b"] }]);
  expect(yield* applyTools(conversation, [a, b])).toEqual([]);
  expect(yield* applyTools(conversation, [a, b, c])).toEqual([{ added: ["c"] }]);
  expect(yield* applyTools(conversation, [a, c])).toEqual([{ removed: ["b"] }]);
  const c2 = declaration("c", "changed");
  expect(yield* applyTools(conversation, [a, c2])).toEqual([{ removed: ["c"], added: ["c"] }]);
  const a2 = declaration("a", "changed");
  expect(yield* applyTools(conversation, [a2, c2])).toEqual([
    { removed: ["a", "c"], added: ["a", "c"] },
  ]);
  expect(yield* applyTools(conversation, [c2, a2])).toEqual([
    { removed: ["a", "c"], added: ["c", "a"] },
  ]);
  expect(yield* applyTools(conversation, [])).toEqual([{ removed: ["c", "a"] }]);
});

const putsToolChanges = Effect.gen(function* () {
  const conversation = yield* root();
  const [a, b] = [declaration("a"), declaration("b")];
  expect(yield* applyTools(conversation, [a], { x: "1", y: "2" })).toEqual([
    { added: ["a"], sections: { x: "1", y: "2" } },
  ]);
  expect(yield* applyTools(conversation, [a, b], { y: "2", x: "1" })).toEqual([
    { sections: { x: null, y: null } },
    { added: ["b"], sections: { y: "2", x: "1" } },
  ]);
  yield* awaited(marker(conversation, "self"));
  expect(yield* applyTools(conversation, [a, b], { y: "2", x: "1" })).toEqual([
    { added: ["a", "b"], sections: { y: "2", x: "1" } },
  ]);
});

describe("tool loadout preparation", () => {
  it("adds, removes, replaces changed declarations, and rewrites the order when needed", () =>
    Effect.runPromise(addsRemovesReplaces));

  it("puts tool changes on the last section entry and re-declares every tool after a head cut", () =>
    Effect.runPromise(putsToolChanges));
});
