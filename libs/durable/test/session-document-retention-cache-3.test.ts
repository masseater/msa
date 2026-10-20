import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import sessionModule from "../src/session/session-state.ts";
import type sessionTypes from "../src/session/session.types.ts";
import sessionDocumentRetentionSupport from "./session-document-retention-support.ts";
import type sessionDocumentRetentionSupportTypes from "./session-document-retention-support.types.ts";
import support from "./support.ts";

const { defineDoc } = durable;
const { setDefaultDocumentRetention } = sessionModule;
const { MemoryStorage } = memory;

const { bump, defaultForRun, open, settleLine } = sessionDocumentRetentionSupport;
const { awaited, chatSetup, context, createConversation, eventually, openChat } = support;

const TestDoc = defineDoc<sessionDocumentRetentionSupportTypes.Counter>({
  fork: "initial",
  history: "latest",
  initial: () => ({ count: 0 }),
  kind: "test.retention.harness",
  scope: "conversation",
  version: 1,
});

const keepsNoTimer = Effect.gen(function* () {
  const setTimer = globalThis.setTimeout;
  let timers = 0;
  const timerSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    ms?: number,
  ) => {
    timers++;
    return Number(Reflect.apply(setTimer, globalThis, [callback, ms]));
  }) as unknown as typeof setTimeout);
  yield* Effect.gen(function* () {
    const { session, clock, sizes } = open(1_000);
    const conversationId = yield* awaited(createConversation(session));
    yield* bump(session, conversationId);
    yield* bump(session, conversationId);
    expect(timers).toBeLessThanOrEqual(1);
    clock.now += 10_000;
    yield* awaited(session.commit(() => Promise.resolve(), context));
    yield* settleLine(session);
    expect(sizes().cached).toBe(0);
    yield* awaited(session.close(context));
  }).pipe(Effect.ensuring(Effect.sync(() => timerSpy.mockRestore())));
});

const followsHarnessSettings = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  setDefaultDocumentRetention(600_000);
  onTestFinished(() => setDefaultDocumentRetention(defaultForRun));
  const setup = chatSetup();
  const settings: {
    -readonly [K in keyof durableTypes.HarnessSettings]: durableTypes.HarnessSettings[K];
  } = setup.settings;
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(TestDoc, root.id))).count++;
          }),
        ),
      context,
    ),
  );
  const sizesOf = () => (harness as unknown as sessionTypes.SessionImpl).documentCacheSizes;
  expect(sizesOf().cached).toBeGreaterThan(0);
  settings.documentRetentionMs = 0;
  yield* awaited(harness.snapshot(TestDoc, root.id, context));
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(
          (harness as unknown as sessionTypes.SessionImpl).readOnLine(() => Promise.resolve()),
        );
        return sizesOf().cached === 0;
      }),
    ),
  );
  yield* awaited(harness.close(context));
});

describe("document cache retention", () => {
  it("keeps no timer where timers cannot be unreferenced, and evicts on commits", () =>
    Effect.runPromise(keepsNoTimer));

  it("follows a Harness settings change at the next use", () =>
    Effect.runPromise(followsHarnessSettings));
});
