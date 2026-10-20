import { Type, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import sessionDocumentRetentionSupport from "./session-document-retention-support.ts";
import type sessionDocumentRetentionSupportTypes from "./session-document-retention-support.types.ts";
import support from "./support.ts";

const { defineDoc, defineTool } = durable;
const { MemoryStorage } = memory;
const { watchEvents } = harnessModule;

const { CounterDoc, bump, open, settleLine } = sessionDocumentRetentionSupport;
const { addTool, awaited, chatSetup, context, createConversation, eventually, openChat } = support;

const stepsTool = defineTool({
  description: "Streams three steps",
  execute: (_args, api) =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const step of ["a\n", "b\n", "c\n"]) {
          api.output(step);
          yield* Effect.sleep(5);
        }
        return {};
      }),
    ),
  name: "steps",
  parameters: Type.Object({}),
});

const eventsWithRetention = Effect.fn("eventsWithRetention")(function* (
  documentRetentionMs: number,
) {
  const setup = chatSetup();
  setup.settings.documentRetentionMs = documentRetentionMs;
  setup.settings.progress = { outputIntervalMs: 0 };
  addTool(setup.registry, stepsTool);
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("steps", {}, { id: "s1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  const events: durableTypes.AgentEvent[] = [];
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(stream.stop());
  yield* awaited(harness.close(context));
  return events.map((event) =>
    event.type === "tool_execution_update" ? `update:${JSON.stringify(event.output)}` : event.type,
  );
});

const givesSameEvents = Effect.gen(function* () {
  expect(yield* eventsWithRetention(0)).toEqual(yield* eventsWithRetention(600_000));
});

describe("document cache retention", () => {
  it("gives the same events with documents evicted right after use as with documents kept", () =>
    Effect.runPromise(givesSameEvents));
});

const keepsReloadedNewer = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const V1 = defineDoc<sessionDocumentRetentionSupportTypes.Counter>({
    initial: () => ({ count: 3 }),
    kind: "test.retention.versioned",
    scope: "session",
    version: 1,
  });
  const V2 = defineDoc<sessionDocumentRetentionSupportTypes.Counter & { v2: true }>({
    initial: () => ({ count: 0, v2: true }),
    kind: "test.retention.versioned",
    migrate: (value) => ({
      count: (value as sessionDocumentRetentionSupportTypes.Counter).count,
      v2: true,
    }),
    scope: "session",
    version: 2,
  });
  const { session, sizes } = open(0);
  yield* awaited(session.commit((tx) => tx.doc(V1).then(() => undefined), context));
  const state = (yield* awaited(session.documentState(V1, context)))!;
  expect(yield* awaited(session.snapshot(V2, context))).toEqual({ count: 3, v2: true });
  yield* settleLine(session);
  expect(sizes().cached).toBe(1);
  state.dispose();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* settleLine(session);
        return sizes().cached === 0;
      }),
    ),
  );
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("keeps a reloaded newer version cached while an observer of the older one is attached", () =>
    Effect.runPromise(keepsReloadedNewer));
});

const queuesOneSweep = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = open(0);
  const conversationIds: durableTypes.ConversationId[] = [];
  for (const _ of Array.from({ length: 50 })) {
    const id = yield* awaited(createConversation(session));
    yield* bump(session, id);
    conversationIds.push(id);
  }
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* settleLine(session);
        return session.documentCacheSizes.cached === 0;
      }),
    ),
  );
  const before = session.documentCacheSizes.sweeps;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            for (const id of conversationIds) {
              (yield* awaited(tx.doc(CounterDoc, id))).count++;
              yield* Effect.sleep(1);
            }
          }),
        ),
      context,
    ),
  );
  yield* settleLine(session);
  expect(session.documentCacheSizes.cached).toBe(0);
  expect(session.documentCacheSizes.sweeps - before).toBeLessThanOrEqual(2);
  yield* awaited(session.close(context));
});

describe("document cache retention", () => {
  it("queues one sweep job, not one per document, while a commit holds the line", () =>
    Effect.runPromise(queuesOneSweep));
});
