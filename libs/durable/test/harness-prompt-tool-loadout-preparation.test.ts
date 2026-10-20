import { type SystemMessage, type Tool, Type } from "@msa/ai";
import { getCurrentTools, toToolDeclaration } from "@msa/ai/utils/transcript";
import { type Conversation, SystemEntry } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { planSystemEntries } from "../src/harness/prompt.ts";
import effectSupport from "./effect-support.ts";
import harnessPromptSupport from "./harness-prompt-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { marker, root } = harnessPromptSupport;
const { context } = sessionSupport;

const declaration = (name: string, description = name): Tool => ({
  description,
  name,
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
  expect(yield* applyTools(conversation, [a, c2])).toEqual([{ added: ["c"], removed: ["c"] }]);
  const a2 = declaration("a", "changed");
  expect(yield* applyTools(conversation, [a2, c2])).toEqual([
    { added: ["a", "c"], removed: ["a", "c"] },
  ]);
  expect(yield* applyTools(conversation, [c2, a2])).toEqual([
    { added: ["c", "a"], removed: ["a", "c"] },
  ]);
  expect(yield* applyTools(conversation, [])).toEqual([{ removed: ["c", "a"] }]);
});

const putsToolChanges = Effect.gen(function* () {
  const conversation = yield* root();
  const [a, b] = [declaration("a"), declaration("b")];
  const reordered = Object.fromEntries([
    ["y", "2"],
    ["x", "1"],
  ]);
  expect(yield* applyTools(conversation, [a], { x: "1", y: "2" })).toEqual([
    { added: ["a"], sections: { x: "1", y: "2" } },
  ]);
  expect(yield* applyTools(conversation, [a, b], reordered)).toEqual([
    { sections: { x: null, y: null } },
    { added: ["b"], sections: reordered },
  ]);
  yield* awaited(marker(conversation, "self"));
  expect(yield* applyTools(conversation, [a, b], reordered)).toEqual([
    { added: ["a", "b"], sections: reordered },
  ]);
});

describe("tool loadout preparation", () => {
  it("adds, removes, replaces changed declarations, and rewrites the order when needed", () =>
    Effect.runPromise(addsRemovesReplaces));

  it("puts tool changes on the last section entry and re-declares every tool after a head cut", () =>
    Effect.runPromise(putsToolChanges));
});
