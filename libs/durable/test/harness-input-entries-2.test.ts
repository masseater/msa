import { type AgentEvent } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  inboxItems,
  toolRunning,
  answer,
  HOLD,
  holdTool,
  transcript,
  requestLog,
} from "./harness-input-entries-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

const watchedHeldChat = Effect.fn("watchedHeldChat")(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  const requests: string[][] = [];
  setup.faux.setResponses([requestLog(requests, HOLD), requestLog(requests, answer("done"))]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const events: AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { gate, requests, harness, root, events, stream };
});

const appendsDataOnly = Effect.gen(function* () {
  const { gate, requests, harness, root, events, stream } = yield* watchedHeldChat();
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* toolRunning(harness, root);
  const chat = { kind: "chat.message", data: { author: "bob", text: "lunch?" } };
  const write = yield* awaited(
    root.submit({ type: "write", entry: chat, requestId: "bob:1" }, context),
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
    entry: { kind: "chat.message", id: settled.status === "done" && settled.entry },
  });
  expect(events.some((event) => event.type === "run_end")).toBe(false);
  expect(
    (yield* awaited(root.submit({ type: "write", entry: chat, requestId: "bob:1" }, context))).id,
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
