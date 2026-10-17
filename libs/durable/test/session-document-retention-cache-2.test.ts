import { fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import {
  type AgentEvent,
  type ConversationId,
  defineDoc,
  defineTool,
  MemoryStorage,
  watchEvents,
} from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import {
  settleLine,
  type Counter,
  CounterDoc,
  bump,
  open,
} from "./session-document-retention-support.ts";
import { context, createConversation } from "./session-support.ts";
import { eventually } from "./task-support.ts";

describe("document cache retention", () => {
  it("gives the same events with documents evicted right after use as with documents kept", async () => {
    const run = async (documentRetentionMs: number): Promise<string[]> => {
      const setup = chatSetup();
      setup.settings.documentRetentionMs = documentRetentionMs;
      setup.settings.progress = { outputIntervalMs: 0 };
      addTool(
        setup.registry,
        defineTool({
          name: "steps",
          description: "Streams three steps",
          parameters: Type.Object({}),
          execute: async (_args, api) => {
            for await (const step of ["a\n", "b\n", "c\n"]) {
              api.output(step);
              await new Promise((resolve) => {
                setTimeout(resolve, 5);
              });
            }
            return {};
          },
        }),
      );
      setup.faux.setResponses([
        fauxAssistantMessage([fauxToolCall("steps", {}, { id: "s1" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("done")]),
      ]);
      const { harness, root } = await openChat(new MemoryStorage(), setup);
      const stream = await watchEvents(harness, root.id, context);
      const events: AgentEvent[] = [];
      stream.start((batch) => {
        events.push(...batch);

        return Promise.resolve();
      });
      await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
      await harness.waitForIdle(context);
      await stream.stop();
      await harness.close(context);
      // Ids and times differ between runs; the sequence of event types and tool outputs must not.
      return events.map((event) =>
        event.type === "tool_execution_update"
          ? `update:${JSON.stringify(event.output)}`
          : event.type,
      );
    };
    expect(await run(0)).toEqual(await run(600_000));
  });
});

describe("document cache retention", () => {
  it("keeps a reloaded newer version cached while an observer of the older one is attached", async () => {
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
    await session.commit((tx) => tx.doc(V1).then(() => undefined), context);
    const state = (await session.documentState(V1, context))!;
    expect(await session.snapshot(V2, context)).toEqual({ count: 3, v2: true });
    await settleLine(session);
    expect(sizes().cached).toBe(1);
    state.dispose();
    await eventually(async () => {
      await settleLine(session);
      return sizes().cached === 0;
    });
    await session.close(context);
  });
});

describe("document cache retention", () => {
  it("queues one sweep job, not one per document, while a commit holds the line", async () => {
    const { session } = open(0);
    const conversationIds: ConversationId[] = [];
    for await (const _ of Array.from({ length: 50 })) {
      const id = await createConversation(session);
      await bump(session, id);
      conversationIds.push(id);
    }
    await eventually(async () => {
      await settleLine(session);
      return session.documentCacheSizes.cached === 0;
    });
    const before = session.documentCacheSizes.sweeps;
    // One commit loads 50 evicted documents from storage, each touched as it loads; the sweep job stays pending while
    // the line is held.
    await session.commit(async (tx) => {
      for await (const id of conversationIds) {
        (await tx.doc(CounterDoc, id)).count++;
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    }, context);
    await settleLine(session);
    expect(session.documentCacheSizes.cached).toBe(0);
    expect(session.documentCacheSizes.sweeps - before).toBeLessThanOrEqual(2);
    await session.close(context);
  });
});
