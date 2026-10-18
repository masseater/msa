import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import { type AgentEvent, type ConversationId, defineDoc, defineTool } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  settleLine,
  type Counter,
  CounterDoc,
  bump,
  open,
} from "./session-document-retention-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  addTool,
  context,
  createConversation,
  eventually,
} from "./support.ts";

const givesSameEvents = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const run = (documentRetentionMs: number): Promise<string[]> =>
    runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const setup = chatSetup();
        setup.settings.documentRetentionMs = documentRetentionMs;
        setup.settings.progress = { outputIntervalMs: 0 };
        addTool(
          setup.registry,
          defineTool({
            name: "steps",
            description: "Streams three steps",
            parameters: Type.Object({}),
            execute: (_args, api) =>
              runPromise(
                Effect.gen(function* () {
                  for (const step of ["a\n", "b\n", "c\n"]) {
                    api.output(step);
                    yield* Effect.sleep(5);
                  }
                  return {};
                }),
              ),
          }),
        );
        setup.faux.setResponses([
          fauxAssistantMessage([fauxToolCall("steps", {}, { id: "s1" })], {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage([fauxText("done")]),
        ]);
        const { harness, root } = yield* openChat(new MemoryStorage(), setup);
        const stream = yield* awaited(watchEvents(harness, root.id, context));
        const events: AgentEvent[] = [];
        stream.start((batch) => {
          events.push(...batch);

          return Promise.resolve();
        });
        yield* awaited(
          (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
        );
        yield* awaited(harness.waitForIdle(context));
        yield* awaited(stream.stop());
        yield* awaited(harness.close(context));
        return events.map((event) =>
          event.type === "tool_execution_update"
            ? `update:${JSON.stringify(event.output)}`
            : event.type,
        );
      }),
    );
  expect(yield* awaited(run(0))).toEqual(yield* awaited(run(600_000)));
});

describe("document cache retention", () => {
  it("gives the same events with documents evicted right after use as with documents kept", () =>
    Effect.runPromise(givesSameEvents));
});

const keepsReloadedNewer = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const V1 = defineDoc<Counter>({
    kind: "test.retention.versioned",
    version: 1,
    scope: "session",
    initial: () => ({ count: 3 }),
  });
  const V2 = defineDoc<Counter & { v2: true }>({
    kind: "test.retention.versioned",
    version: 2,
    scope: "session",
    initial: () => ({ count: 0, v2: true }),
    migrate: (value) => ({ count: (value as Counter).count, v2: true }),
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
  const conversationIds: ConversationId[] = [];
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
