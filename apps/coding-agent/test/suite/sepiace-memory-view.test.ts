import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import MemoryView from "../../src/modes/interactive/components/memory-view.ts";
import themeModule from "../../src/modes/interactive/theme/theme.ts";
import ansi from "../../src/utils/ansi.ts";
import agentSessionMcpOauthHarness from "./agent-session-mcp-oauth-harness.ts";
import sepiaceMemorySupport from "./sepiace-memory-support.ts";

const { fauxAssistantMessage } = ai;
const { initTheme } = themeModule;
const { stripAnsi } = ansi;
const { runCleanups } = agentSessionMcpOauthHarness;
const { openSession, startSepiace } = sepiaceMemorySupport;

const ENTER = "\r";
const ESC = "\x1b";
const PAGE_DOWN = "\x1b[6~";

beforeAll(() => {
  initTheme(undefined, false);
});

afterEach(() => runCleanups());

const longReply = Array.from({ length: 80 }, (_, index) => `reply line ${index + 1}`).join("\n");

const openView = Effect.gen(function* () {
  const server = yield* Effect.promise(() =>
    startSepiace((request) => (request === "long" ? longReply : `got: ${request}`)),
  );
  const { harness } = yield* Effect.promise(() => openSession({ url: server.url }));
  const service = harness.session.integrations.memory.memory;
  if (service === undefined) throw new Error("memory is off");
  let closed = false;
  let renders = 0;
  const view = new MemoryView({
    maxHeight: () => 20,
    onClose: () => {
      closed = true;
    },
    requestRender: () => {
      renders += 1;
    },
    service,
    setRecall: (enabled) => harness.settingsManager.context.setMemoryRecallEnabled(enabled),
  });
  const screen = () =>
    view
      .render(100)
      .map((line) => stripAnsi(line))
      .join("\n");
  const type = (text: string) => {
    for (const character of text) view.handleInput(character);
  };
  return { closed: () => closed, harness, renders: () => renders, screen, server, type, view };
});

const sendsARequestTypedIntoTheView = Effect.gen(function* () {
  const { screen, server, type, view } = yield* openView;
  view.handleInput(ENTER);
  type("Forget the old address.");
  view.handleInput(ENTER);
  for (let attempt = 0; attempt < 100 && !screen().includes("got: "); attempt++)
    yield* Effect.sleep("20 millis");
  expect(server.memoryRequests).toEqual(["Forget the old address."]);
  expect(screen()).toContain("got: Forget the old address.");
});

const turnsRecallOffAndClosesWithEscape = Effect.gen(function* () {
  const { closed, harness, server, view } = yield* openView;
  view.handleInput("r");
  harness.setResponses([fauxAssistantMessage("ok")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("where does the release go?"));
  expect(server.memoryRequests).toEqual([]);
  view.handleInput(ESC);
  expect(closed()).toBe(true);
});

const scrollsThroughALongReply = Effect.gen(function* () {
  const { screen, type, view } = yield* openView;
  view.handleInput(ENTER);
  type("long");
  view.handleInput(ENTER);
  for (let attempt = 0; attempt < 100 && !screen().includes("reply line 1"); attempt++)
    yield* Effect.sleep("20 millis");
  expect(screen()).toContain("reply line 1\n");
  expect(screen()).not.toContain("reply line 80");
  for (let page = 0; page < 10; page++) view.handleInput(PAGE_DOWN);
  expect(screen()).toContain("reply line 80");
});

describe("memory view", () => {
  it("sends a request typed into the view and shows the reply", () =>
    Effect.runPromise(sendsARequestTypedIntoTheView));
  it("scrolls through a reply longer than the view", () =>
    Effect.runPromise(scrollsThroughALongReply));
  it("turns recall off with r and closes with escape", () =>
    Effect.runPromise(turnsRecallOffAndClosesWithEscape));
});
