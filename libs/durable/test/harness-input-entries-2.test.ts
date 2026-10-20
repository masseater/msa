import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessInputEntriesSupport from "./harness-input-entries-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { MemoryStorage } = memory;
const { watchEvents } = harnessModule;

const { allEntries, chatSetup, openChat, waitFor } = chatSupport;
const { awaited } = effectSupport;
const { HOLD, answer, holdTool, inboxItems, requestLog, toolRunning, transcript } =
  harnessInputEntriesSupport;
const { context } = sessionSupport;
const { deferred } = taskSupport;

const watchedHeldChat = Effect.fn("watchedHeldChat")(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  const requests: string[][] = [];
  setup.faux.setResponses([requestLog(requests, HOLD), requestLog(requests, answer("done"))]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const events: durableTypes.AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { events, gate, harness, requests, root, stream };
});

const appendsDataOnly = Effect.gen(function* () {
  const { gate, requests, harness, root, events, stream } = yield* watchedHeldChat();
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* toolRunning(harness, root);
  const chat = { data: { author: "bob", text: "lunch?" }, kind: "chat.message" };
  const write = yield* awaited(
    root.submit({ entry: chat, requestId: "bob:1", type: "write" }, context),
  );
  const settled = yield* awaited(write.status(context));
  expect(settled.status).toBe("done");
  expect(yield* inboxItems(harness, root)).toEqual([]);
  expect(transcript(yield* allEntries(root))).toEqual([
    ["msa.user", "a"],
    ["msa.assistant"],
    ["chat.message", { author: "bob", text: "lunch?" }],
  ]);
  yield* waitFor(() => events.some((event) => event.type === "entry_appended"));
  const appended = events.find((event) => event.type === "entry_appended");
  expect(appended).toMatchObject({
    entry: { id: settled.status === "done" && settled.entry, kind: "chat.message" },
  });
  expect(events.some((event) => event.type === "run_end")).toBe(false);
  expect(
    (yield* awaited(root.submit({ entry: chat, requestId: "bob:1", type: "write" }, context))).id,
  ).toBe(write.id);

  gate.resolve();
  yield* awaited(input.wait(context));
  expect(transcript(yield* allEntries(root))).toEqual([
    ["msa.user", "a"],
    ["msa.assistant"],
    ["chat.message", { author: "bob", text: "lunch?" }],
    ["msa.tool-result"],
    ["msa.assistant", "done"],
  ]);
  expect(requests).toEqual([
    ["system:", "user:a"],
    ["system:", "user:a", "assistant:", "toolResult:held"],
  ]);
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
});

describe("data-only writes", () => {
  it("appends a data-only write mid-run in time order, leaving the model's messages unchanged", () =>
    Effect.runPromise(appendsDataOnly));
});
