import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import harness from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import agentModule from "../src/harness/agent.ts";
import prompt from "../src/harness/prompt.ts";
import harnessPromptSupport from "./harness-prompt-support.ts";
import support from "./support.ts";

const { planSystemEntries, renderSections, replaySections } = prompt;
const { SystemEntry, defineExtension, wrapSection } = durable;
const { createRegistry } = harness;
const { resolveAgent, resolveSettings } = agentModule;

const { marker, root } = harnessPromptSupport;
const { abortController, addSection, awaited, context, failure, user } = support;

type Planned = {
  readonly sections: Record<string, string | null>;
  readonly omit?: readonly durableTypes.EntryId[];
};

const apply = Effect.fn("apply")(function* (
  conversation: durableTypes.Conversation,
  desired: Record<string, string>,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const drafts = planSystemEntries(
    yield* awaited(conversation.context(context)),
    new Map(Object.entries(desired)),
    [],
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
  const replayed = replaySections((yield* awaited(conversation.context(context))).messages);
  expect([...replayed]).toEqual(Object.entries(desired));
  return drafts.map((draft): Planned => {
    const message = draft.model![0] as aiTypes.SystemMessage;
    expect(message).toMatchObject({ content: "", role: "system", timestamp: 7 });
    const omit = draft.edits?.map((edit) => {
      expect(edit.action).toBe("omit");
      return edit.target;
    });
    return omit === undefined
      ? { sections: message.sections! }
      : { omit, sections: message.sections! };
  });
});

const lastSystemId = Effect.fn("lastSystemId")(function* (conversation: durableTypes.Conversation) {
  const page = yield* awaited(conversation.entries({}, 100, undefined, context));
  return page.items.find((entry) => entry.kind === "msa.system")!.id;
});

function section(
  key: string,
  render: durableTypes.PromptSection<durableTypes.ToolRegistration>["render"],
  tag?: boolean,
) {
  return tag === undefined ? { key, render } : { key, render, tag };
}

const input: durableTypes.PromptInput<durableTypes.ToolRegistration> = {
  agent: {
    callable: [],
    deferred: [],
    extensions: [],
    sections: [],
    thinkingLevel: "off",
    tools: [],
  },
  conversationId: 1 as never,
  env: undefined,
  read: {
    snapshot: () => Promise.resolve(undefined),
    snapshotAsOf: () => Promise.resolve(undefined),
  },
  shown: {},
};

function sectionRegistry() {
  const registry = createRegistry();
  addSection(registry, "preamble", () => "You are helpful.", { tag: false });
  addSection(registry, "cwd", () => Promise.resolve("/repo"));
  addSection(registry, "skipped", () => undefined);
  addSection(registry, "failing", () => {
    throw new Error("render failed");
  });
  addSection(registry, "new-failing", () => {
    throw new Error("also failed");
  });
  registry.install(
    defineExtension({
      name: "git",
      wraps: [
        wrapSection("cwd", (inner) => ({
          ...inner,
          render: (value, ctx) =>
            Effect.runPromise(
              Effect.gen(function* () {
                return `${yield* awaited(inner.render(value, ctx))} (git)`;
              }),
            ),
        })),
      ],
    }),
  );
  return { registry };
}

const rendersSectionsOrder = Effect.gen(function* () {
  const { registry } = sectionRegistry();
  const reports: unknown[] = [];
  const shown = new Map([
    ["failing", "<failing>\nold\n</failing>"],
    ["cwd", "stale"],
  ]);
  const agent = resolveAgent(
    undefined,
    registry.snapshot(),
    resolveSettings(undefined),
    (error) => {
      throw error;
    },
  );
  const desired = yield* renderSections(
    agent.sections,
    input,
    shown,
    (error) => reports.push(error),
    context,
  );
  expect([...desired]).toEqual([
    ["preamble", "You are helpful."],
    ["cwd", "<cwd>\n/repo (git)\n</cwd>"],
    ["failing", "<failing>\nold\n</failing>"],
  ]);
  expect(reports.map((error) => (error as Error).message)).toEqual([
    "render failed",
    "also failed",
  ]);
});

const propagatesSectionErrors = Effect.gen(function* () {
  const controller = abortController();
  controller.abort(new Error("cancelled"));
  const cancelled = { ...context, abortSignal: controller.signal };
  const failing = section("a", () => {
    throw new Error("cancelled");
  });
  expect(
    yield* failure(renderSections([failing], input, new Map(), () => {}, cancelled)),
  ).toMatchObject({ message: expect.stringContaining("cancelled") });
});

describe("system prompt preparation", () => {
  it("renders sections in order with tags, omissions, wrappers, and failures", () =>
    Effect.runPromise(rendersSectionsOrder));

  it("propagates section errors after cancellation", () =>
    Effect.runPromise(propagatesSectionErrors));
});

const emitsMinimalValue = Effect.gen(function* () {
  const conversation = yield* root();
  expect(yield* apply(conversation, { a: "1", b: "2", c: "3" })).toEqual([
    { sections: { a: "1", b: "2", c: "3" } },
  ]);
  expect(yield* apply(conversation, { a: "1", b: "20", c: "3", d: "4" })).toEqual([
    { sections: { b: "20", d: "4" } },
  ]);
  expect(yield* apply(conversation, { a: "1", c: "3", d: "4" })).toEqual([
    { sections: { b: null } },
  ]);
  expect(yield* apply(conversation, { a: "1", c: "3", d: "4" })).toEqual([]);
  expect(yield* apply(conversation, {})).toEqual([{ sections: { a: null, c: null, d: null } }]);
});

describe("system prompt preparation", () => {
  it("replays sections in place, deletes on null, and appends re-additions", () => {
    const system = (sections: Record<string, string | null>): aiTypes.SystemMessage => ({
      content: "",
      role: "system",
      sections,
      timestamp: 1,
    });
    const shown = replaySections([
      system({ a: "1", b: "2", c: "3" }),
      user("x"),
      system({ a: null, b: "20" }),
      system({ a: "10" }),
    ]);
    expect([...shown]).toEqual([
      ["b", "20"],
      ["c", "3"],
      ["a", "10"],
    ]);
  });

  it("emits minimal value patches, removals, and additions", () =>
    Effect.runPromise(emitsMinimalValue));
});

const rewritesOrderOnly = Effect.gen(function* () {
  const conversation = yield* root();
  yield* apply(conversation, { a: "1", b: "2" });
  const reordered = Object.fromEntries([
    ["b", "2"],
    ["a", "1"],
  ]);
  expect(yield* apply(conversation, reordered)).toEqual([
    { sections: { a: null, b: null } },
    { sections: reordered },
  ]);
  const readded = yield* root();
  yield* apply(readded, { a: "1", b: "2", c: "3" });
  expect(yield* apply(readded, { a: "1", c: "3" })).toEqual([{ sections: { b: null } }]);
  expect(yield* apply(readded, { a: "1", b: "2", c: "3" })).toEqual([
    { sections: { a: null, c: null } },
    { sections: { a: "1", b: "2", c: "3" } },
  ]);
});

const rebaselinesHeadMarker = Effect.gen(function* () {
  const conversation = yield* root();
  yield* apply(conversation, { a: "1", b: "2" });
  yield* awaited(
    conversation.commit(
      (tx) => tx.appendEntry(conversation.id, { kind: "msa.user", model: [user("hi")] }),
      context,
    ),
  );
  yield* apply(conversation, { a: "1", b: "20" });
  const delta = yield* lastSystemId(conversation);
  yield* awaited(marker(conversation, delta));
  expect(yield* apply(conversation, { a: "1", b: "20" })).toEqual([
    { omit: [delta], sections: { a: "1", b: "20" } },
  ]);
  const baseline = yield* lastSystemId(conversation);
  expect(yield* apply(conversation, { a: "1", b: "21" })).toEqual([{ sections: { b: "21" } }]);
  const after = yield* lastSystemId(conversation);
  yield* awaited(marker(conversation, delta));
  expect(yield* apply(conversation, { a: "1", b: "21" })).toEqual([
    { omit: [delta, baseline, after], sections: { a: "1", b: "21" } },
  ]);
});

describe("system prompt preparation", () => {
  it("rewrites order-only changes and re-additions as two entries", () =>
    Effect.runPromise(rewritesOrderOnly));

  it("rebaselines after a head marker, omitting retained deltas on both sides of it", () =>
    Effect.runPromise(rebaselinesHeadMarker));
});

const writesCompletePost = Effect.gen(function* () {
  const conversation = yield* root();
  yield* apply(conversation, { a: "1" });
  const baseline = yield* lastSystemId(conversation);
  yield* awaited(marker(conversation, baseline));
  expect(yield* apply(conversation, { a: "1" })).toEqual([
    { omit: [baseline], sections: { a: "1" } },
  ]);
  yield* awaited(marker(conversation, "self"));
  expect(yield* apply(conversation, {})).toEqual([{ sections: {} }]);
  expect(yield* apply(conversation, {})).toEqual([]);
});

describe("system prompt preparation", () => {
  it("writes a complete post-head baseline even when replay already matches", () =>
    Effect.runPromise(writesCompletePost));
});
