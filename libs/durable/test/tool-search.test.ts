import ai from "@msa/ai";
import durable from "@msa/durable";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";
import toolSearchSupport from "./tool-search-support.ts";

const { Type } = ai;

const { MemoryStorage } = memory;
const { AgentDoc, defineTool } = durable;

const { DONE, call, offered, setup, systemMessages, toolResultTexts } = toolSearchSupport;

const { allEntries, openChat } = chatSupport;

const { awaited } = effectSupport;

const { addTool } = harnessSupport;

const { context } = sessionSupport;

const offersDeferredTool = Effect.gen(function* () {
  const chat = setup();
  chat.faux.setResponses([
    call("tool_search", { limit: 1, query: "github issue" }),
    call("github_get_issue", { number: 42 }, "c2"),
    DONE,
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), chat);
  expect(yield* offered(root)).toEqual(["alpha", "omega", "tool_search"]);
  expect((yield* awaited(root.agent(context))).deferred.map((each) => each.name)).toEqual([
    "github_get_issue",
    "github_list_repos",
  ]);
  expect((yield* awaited(root.agent(context))).callable.map((each) => each.name)).toContain(
    "github_get_issue",
  );
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const entries = yield* allEntries(root);
  const [search, issue] = toolResultTexts(entries);
  expect(search).toBe(
    "Loaded 1 tool. They are available from your next call:\n- github_get_issue: Get a GitHub issue by number",
  );
  expect(issue).toBe("github_get_issue ran");
  expect((yield* awaited(harness.snapshot(AgentDoc, root.id, context)))?.modelTools).toEqual({
    add: ["github_get_issue"],
  });
  expect(yield* offered(root)).toEqual(["alpha", "omega", "tool_search", "github_get_issue"]);
  expect((yield* awaited(root.agent(context))).deferred.map((each) => each.name)).toEqual([
    "github_list_repos",
  ]);
  const [baseline, load] = systemMessages(entries);
  expect(baseline!.toolsAdded!.map((each) => each.name)).toEqual(["alpha", "omega", "tool_search"]);
  expect(load).toEqual(
    expect.objectContaining({
      toolsAdded: [expect.objectContaining({ name: "github_get_issue" })],
    }),
  );
  expect(load!.toolsRemoved).toBeUndefined();
  yield* awaited(harness.close(context));
});

const appendsEachLoaded = Effect.gen(function* () {
  const chat = setup();
  chat.faux.setResponses([
    call("tool_search", { limit: 1, query: "repositories" }),
    call("tool_search", { limit: 1, query: "issue" }, "c2"),
    DONE,
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), chat);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect(yield* offered(root)).toEqual([
    "alpha",
    "omega",
    "tool_search",
    "github_list_repos",
    "github_get_issue",
  ]);
  const loads = systemMessages(yield* allEntries(root)).slice(1);
  expect(loads.map((message) => message.toolsAdded?.map((each) => each.name))).toEqual([
    ["github_list_repos"],
    ["github_get_issue"],
  ]);
  expect(loads.every((message) => message.toolsRemoved === undefined)).toBe(true);
  yield* awaited(harness.close(context));
});

const recordsLoadsName = Effect.gen(function* () {
  const chat = setup();
  const grow = defineTool({
    description: "grow",
    execute: () =>
      Promise.resolve({
        control: { addTools: ["github_get_issue", "alpha", "ghost"] },
        output: [],
      }),
    name: "grow",
    parameters: Type.Object({}),
  });
  addTool(chat.registry, grow);
  chat.faux.setResponses([call("grow"), DONE, call("grow"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), chat);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  expect((yield* awaited(harness.snapshot(AgentDoc, root.id, context)))?.modelTools).toEqual({
    add: ["github_get_issue", "alpha", "ghost"],
  });
  expect(yield* offered(root)).toEqual([
    "alpha",
    "omega",
    "tool_search",
    "grow",
    "github_get_issue",
  ]);
  const [getIssue] = (yield* awaited(root.agent(context))).callable.filter(
    (each) => each.name === "github_get_issue",
  );
  yield* awaited(
    root.configure({ modelTools: { add: [getIssue!], remove: [getIssue!] } }, context),
  );
  expect(yield* offered(root)).not.toContain("github_get_issue");
  yield* awaited(
    (yield* awaited(root.submit({ content: "again", type: "input" }, context))).wait(context),
  );
  expect((yield* awaited(harness.snapshot(AgentDoc, root.id, context)))?.modelTools).toEqual({
    add: ["github_get_issue", "alpha", "ghost"],
  });
  expect(yield* offered(root)).toContain("github_get_issue");
  yield* awaited(harness.close(context));
});

describe("deferred tools and tool_search", () => {
  it("offers a deferred tool only once tool_search loads it, by appending its declaration", () =>
    Effect.runPromise(offersDeferredTool));
});

describe("deferred tools and tool_search", () => {
  it("appends each loaded tool in load order, not registry order", () =>
    Effect.runPromise(appendsEachLoaded));
});

describe("deferred tools and tool_search", () => {
  it("records loads by name: unknown and non-deferred names change nothing, remove wins, and a load lifts it", () =>
    Effect.runPromise(recordsLoadsName));
});
