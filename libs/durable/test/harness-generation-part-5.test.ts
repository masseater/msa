import { type Message, type SimpleStreamOptions, fauxAssistantMessage } from "@msa/ai";
import { type HarnessSettings, ProviderDoc } from "@msa/durable";
import { Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessGenerationSupport from "./harness-generation-support.ts";
import sessionSupport from "./session-support.ts";

const { chatSetup, openChat } = chatSupport;
const { awaited } = effectSupport;
const { ERROR_503 } = harnessGenerationSupport;
const { context } = sessionSupport;

const keepsProviderSessionStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const seen = new Map<string, string[]>();
  const capture = (request: { messages: readonly Message[] }, options?: SimpleStreamOptions) => {
    const message = request.messages.findLast((candidate) => candidate.role === "user");
    const content = message?.role === "user" ? message.content : undefined;
    const text = typeof content === "string" ? content : "";
    const values = seen.get(text) ?? [];
    values.push(options?.sessionId ?? "");
    seen.set(text, values);
    return fauxAssistantMessage(`answer:${text}`);
  };
  setup.faux.setResponses([capture, capture, capture, capture]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const child = yield* awaited(
    harness.createConversation(
      {
        agent: { model: { modelId: "faux-1", provider: "faux" } },
        ownership: { kind: "ownerless" },
      },
      context,
    ),
  );
  harness.resume();
  yield* awaited(
    Promise.all(
      [root, child].map((conversation, index) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(
              (yield* awaited(
                conversation.submit({ content: `first-${index}`, type: "input" }, context),
              )).wait(context),
            );
          }),
        ),
      ),
    ),
  );
  return { child, harness, root, runPromise, seen };
});

const keepsProviderSession = Effect.gen(function* () {
  const { runPromise, seen, harness, root, child } = yield* keepsProviderSessionStep1;
  yield* awaited(
    Promise.all(
      [root, child].map((conversation, index) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(
              (yield* awaited(
                conversation.submit({ content: `second-${index}`, type: "input" }, context),
              )).wait(context),
            );
          }),
        ),
      ),
    ),
  );
  const rootId = (yield* awaited(harness.snapshot(ProviderDoc, root.id, context)))!.sessionId;
  const childId = (yield* awaited(harness.snapshot(ProviderDoc, child.id, context)))!.sessionId;
  expect(rootId).not.toBe(childId);
  expect(seen.get("first-0")).toEqual([rootId]);
  expect(seen.get("second-0")).toEqual([rootId]);
  expect(seen.get("first-1")).toEqual([childId]);
  expect(seen.get("second-1")).toEqual([childId]);
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("keeps provider session IDs request-local across concurrent conversations", () =>
    Effect.runPromise(keepsProviderSession));
});

const createsPersistsProvider = Effect.gen(function* () {
  const setup = chatSetup();
  let sent: string | undefined;
  setup.faux.setResponses([
    (_request, options) => {
      sent = options?.sessionId;
      return fauxAssistantMessage("ok");
    },
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.commit((tx) => tx.retireDoc(ProviderDoc, root.id), context));
  expect(yield* awaited(harness.snapshot(ProviderDoc, root.id, context))).toBeUndefined();
  harness.resume();
  yield* awaited(
    (yield* awaited(root.submit({ content: "legacy", type: "input" }, context))).wait(context),
  );
  const stored = yield* awaited(harness.snapshot(ProviderDoc, root.id, context));
  expect(stored?.sessionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(sent).toBe(stored?.sessionId);
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("creates and persists provider state before a legacy conversation's request", () =>
    Effect.runPromise(createsPersistsProvider));
});

const readsSettingsThrough = Effect.gen(function* () {
  const setup = chatSetup();
  let timeoutMs = 111;
  const seen: (number | undefined)[] = [];
  setup.faux.setResponses([
    (_context, options) => {
      seen.push(options?.timeoutMs);
      timeoutMs = 222;
      return ERROR_503;
    },
    (_context, options) => {
      seen.push(options?.timeoutMs);
      return fauxAssistantMessage("ok");
    },
  ]);
  const settings: HarnessSettings = {
    retry: { baseDelayMs: 1 },
    get stream() {
      return { timeoutMs };
    },
  };
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      { models: setup.models, registry: setup.registry, settings },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );
  harness.resume();
  expect(
    (yield* awaited(
      (yield* awaited(root.submit({ content: "hi", type: "input" }, context))).wait(context),
    )).status,
  ).toBe("done");
  expect(seen).toEqual([111, 222]);
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("reads settings through getters at every decision", () =>
    Effect.runPromise(readsSettingsThrough));
});
