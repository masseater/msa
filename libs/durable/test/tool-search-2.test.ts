import durable from "@msa/durable";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import toolSearchSupport from "./tool-search-support.ts";

const { MemoryStorage } = memory;
const { AgentDoc, defineExtension } = durable;

const { DONE, call, offered, setup, systemMessages, tool, toolResultTexts } = toolSearchSupport;

const { allEntries, openChat } = chatSupport;

const { awaited } = effectSupport;
const { context } = sessionSupport;

const keepsLoadedTool = Effect.gen(function* () {
  const chat = setup();
  const issue = tool("github_get_issue", "Get a GitHub issue by number", { deferred: true });
  chat.faux.setResponses([call("tool_search", { limit: 1, query: "github issue" }), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), chat);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  chat.registry.install(defineExtension({ name: "tool:github_get_issue", tools: [] }));
  expect(yield* offered(root)).not.toContain("github_get_issue");
  chat.registry.install(defineExtension({ name: "tool:github_get_issue", tools: [issue] }));
  expect(yield* offered(root)).toContain("github_get_issue");
  const alpha = (yield* awaited(root.agent(context))).tools.find((each) => each.name === "alpha")!;
  const search = (yield* awaited(root.agent(context))).tools.find(
    (each) => each.name === "tool_search",
  )!;
  yield* awaited(root.configure({ modelTools: [alpha, search] }, context));
  chat.faux.setResponses([call("tool_search", { limit: 1, query: "repositories" }), DONE]);
  yield* awaited(
    (yield* awaited(root.submit({ content: "more", type: "input" }, context))).wait(context),
  );
  expect((yield* awaited(harness.snapshot(AgentDoc, root.id, context)))?.modelTools).toEqual([
    "alpha",
    "tool_search",
    "github_list_repos",
  ]);
  yield* awaited(harness.close(context));
});

const keepsLoadedTools = Effect.gen(function* () {
  const chat = setup();
  chat.faux.setResponses([call("tool_search", { limit: 1, query: "github issue" }), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), chat);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const entries = yield* allEntries(root);
  const before = yield* awaited(
    root.fork(entries[0]!.id, { ownership: { kind: "ownerless" } }, context),
  );
  const after = yield* awaited(
    root.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context),
  );
  expect(yield* offered(before)).not.toContain("github_get_issue");
  expect(yield* offered(after)).toContain("github_get_issue");
  yield* awaited(root.reset(undefined, context));
  chat.faux.setResponses([DONE]);
  yield* awaited(
    (yield* awaited(root.submit({ content: "fresh", type: "input" }, context))).wait(context),
  );
  const baseline = systemMessages(yield* allEntries(root)).at(-1)!;
  expect(baseline.toolsAdded!.map((each) => each.name)).toEqual([
    "alpha",
    "omega",
    "tool_search",
    "github_get_issue",
  ]);
  yield* awaited(harness.close(context));
});

const findsNothingUnrelated = Effect.gen(function* () {
  const chat = setup();
  chat.faux.setResponses([call("tool_search", { query: "weather forecast" }), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), chat);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(toolResultTexts(yield* allEntries(root))).toEqual(["No matching tools found."]);
  expect(
    (yield* awaited(harness.snapshot(AgentDoc, root.id, context)))?.modelTools,
  ).toBeUndefined();
  yield* awaited(harness.close(context));
});

describe("deferred tools and tool_search", () => {
  it("keeps a loaded tool when its extension is gone for a while, and appends to an explicit array", () =>
    Effect.runPromise(keepsLoadedTool));
});

describe("deferred tools and tool_search", () => {
  it("keeps loaded tools per branch and in the baseline after a reset", () =>
    Effect.runPromise(keepsLoadedTools));

  it("finds nothing for an unrelated query and loads nothing", () =>
    Effect.runPromise(findsNothingUnrelated));
});
