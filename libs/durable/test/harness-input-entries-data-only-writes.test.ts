import { fauxAssistantMessage } from "@msa/ai";
import durable from "@msa/durable";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import harnessInputEntriesSupport from "./harness-input-entries-support.ts";
import support from "./support.ts";

const { MemoryStorage } = memory;
const { LiveDoc } = durable;
const { openNodeSqliteStorage } = node;

const { answer, gated, inboxItems, mention, requestLog, transcript } = harnessInputEntriesSupport;
const {
  addSection,
  allEntries,
  awaited,
  chatSetup,
  context,
  deferred,
  makeTempFile,
  openChat,
  removeDir,
} = support;

const queuesDataOnly = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  yield* awaited(root.reset(undefined, context));
  const chat = yield* awaited(
    root.submit({ entry: { data: "hi", kind: "chat.message" }, type: "write" }, context),
  );
  expect((yield* awaited(chat.status(context))).status).toBe("queued");
  first.release();
  yield* awaited(input.wait(context));
  const settled = yield* awaited(chat.wait(context));
  const entries = yield* allEntries(root);
  const reset = entries.find((entry) => entry.kind === "msa.reset")!;
  expect(settled.status === "done" && settled.entry).toBeGreaterThan(reset.id);
  expect((yield* awaited(root.context(context))).entries.map((entry) => entry.kind)).toEqual([
    "msa.reset",
    "chat.message",
  ]);
  const later = yield* awaited(
    root.submit({ entry: { data: "again", kind: "chat.message" }, type: "write" }, context),
  );
  expect((yield* awaited(later.status(context))).status).toBe("done");
  yield* awaited(harness.close(context));
});

describe("data-only writes", () => {
  it("queues a data-only write behind a queued reset, so it lands after the reset and stays visible", () =>
    Effect.runPromise(queuesDataOnly));
});

const leavesRequestUnchanged = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const rendering = deferred();
  const render = deferred();
  let renders = 0;
  addSection(setup.registry, "slow", () =>
    runPromise(
      Effect.gen(function* () {
        if (renders++ === 1) {
          rendering.resolve();
          yield* awaited(render.promise);
        }
        return "SLOW";
      }),
    ),
  );
  const requests: string[][] = [];
  setup.faux.setResponses([
    requestLog(requests, answer("one")),
    requestLog(requests, answer("two")),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ content: "a", type: "input" }, context))).wait(context),
  );
  const second = yield* awaited(root.submit({ content: "b", type: "input" }, context));
  yield* awaited(rendering.promise);
  yield* awaited(
    root.submit({ entry: { data: "hi", kind: "chat.message" }, type: "write" }, context),
  );
  render.resolve();
  yield* awaited(second.wait(context));
  expect(requests[1]).toEqual(["system:", "user:a", "assistant:one", "user:b"]);
  const kinds = (yield* allEntries(root)).map((entry) => entry.kind);
  expect(kinds).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
    "msa.user",
    "chat.message",
    "msa.assistant",
  ]);
  yield* awaited(harness.close(context));
});

describe("data-only writes", () => {
  it("leaves the request unchanged by a data-only write that lands while the generation prepares", () =>
    Effect.runPromise(leavesRequestUnchanged));
});

const appendsDataOnly = Effect.gen(function* () {
  const setup = chatSetup();
  const failing = gated(
    fauxAssistantMessage([], { errorMessage: "invalid request", stopReason: "error" }),
  );
  setup.faux.setResponses([failing.step, answer("for f")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(failing.reached);
  const f = yield* awaited(
    root.submit({ content: "f", entry: mention("f"), type: "input" }, context),
  );
  failing.release();
  expect(yield* awaited(input.wait(context))).toMatchObject({
    reason: "model_error",
    status: "unanswered",
  });
  yield* awaited(harness.waitForIdle(context));
  const note = yield* awaited(
    root.submit({ entry: { data: "n", kind: "note" }, type: "write" }, context),
  );
  expect((yield* awaited(note.status(context))).status).toBe("done");
  yield* awaited(harness.waitForIdle(context));
  expect((yield* awaited(f.status(context))).status).toBe("queued");
  expect((yield* inboxItems(harness, root)).map((item) => item.id)).toEqual([f.id]);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  expect(setup.faux.state.callCount).toBe(1);
  const g = yield* awaited(root.submit({ content: "g", type: "input" }, context));
  yield* awaited(g.wait(context));
  expect(transcript(yield* allEntries(root)).filter(([kind]) => kind !== "msa.assistant")).toEqual([
    ["msa.user", "a"],
    ["note", "n"],
    ["chat.mention", { author: "ann", text: "f" }, "f"],
    ["msa.user", "g"],
  ]);
  yield* awaited(harness.close(context));
});

describe("data-only writes", () => {
  it("appends a data-only write while idle after a failed run without placing the queued items", () =>
    Effect.runPromise(appendsDataOnly));
});

const keepsQueuedInput = Effect.gen(function* () {
  const { directory, path } = yield* makeTempFile("msa-durable-input-entries-", "session.sqlite");
  yield* Effect.gen(function* () {
    const setup = chatSetup();
    const first = gated(answer("first"));
    setup.faux.setResponses([first.step, answer("first again"), answer("for f")]);
    let opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
    yield* awaited(opened.root.submit({ content: "a", type: "input" }, context));
    yield* awaited(first.reached);
    const f = (yield* awaited(
      opened.root.submit({ content: "f", entry: mention("f"), type: "input" }, context),
    )).id;
    yield* awaited(opened.harness.close(context));

    opened = yield* openChat(yield* awaited(openNodeSqliteStorage(path)), setup);
    expect(
      (yield* inboxItems(opened.harness, opened.root)).find((item) => item.id === f),
    ).toMatchObject({
      entry: mention("f"),
    });
    const settled = yield* awaited(
      (yield* awaited(opened.harness.submission(f, context)))!.wait(context),
    );
    const placed = (yield* allEntries(opened.root)).find((entry) => entry.kind === "chat.mention")!;
    expect(settled).toMatchObject({ entry: placed.id, status: "done" });
    expect(placed).toMatchObject({
      data: mention("f").data,
      model: [{ content: "f", role: "user" }],
    });
    yield* awaited(opened.harness.close(context));
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => removeDir(directory)))));
});

describe("data-only writes", () => {
  it("keeps a queued input's entry across reopen and places it as that entry", () =>
    Effect.runPromise(keepsQueuedInput));
});

const appendsDataOnlyWrite = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("second")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const followUp = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  const model = yield* awaited(
    root.submit(
      {
        entry: { kind: "note", model: [{ content: "m", role: "user", timestamp: 0 }] },
        type: "write",
      },
      context,
    ),
  );
  const target = (yield* allEntries(root)).find((entry) => entry.kind === "msa.user")!;
  const edit = yield* awaited(
    root.submit(
      {
        entry: { edits: [{ action: "omit", target: target.id }], kind: "redact" },
        type: "write",
      },
      context,
    ),
  );
  const note = yield* awaited(
    root.submit({ entry: { data: "n", kind: "note" }, type: "write" }, context),
  );
  expect((yield* awaited(note.status(context))).status).toBe("done");
  expect((yield* inboxItems(harness, root)).map((item) => [item.id, item.mode])).toEqual([
    [followUp.id, "followUp"],
    [model.id, "write"],
    [edit.id, "write"],
  ]);
  first.release();
  yield* awaited(followUp.wait(context));
  expect(transcript(yield* allEntries(root))).toEqual([
    ["msa.user", "a"],
    ["note", "n"],
    ["msa.assistant", "first"],
    ["note", "m"],
    ["redact"],
    ["msa.user", "f"],
    ["msa.assistant", "second"],
  ]);
  expect(yield* awaited(input.status(context))).toMatchObject({ status: "done" });
  yield* awaited(harness.close(context));
});

describe("data-only writes", () => {
  it("appends a data-only write at once behind a non-empty inbox, and still queues writes with model or edits", () =>
    Effect.runPromise(appendsDataOnlyWrite));
});
