import { defineDoc, type HarnessSettings } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import { SessionImpl, setDefaultDocumentRetention } from "../src/session/session.ts";
import {
  settleLine,
  type Counter,
  bump,
  open,
  defaultForRun,
} from "./session-document-retention-support.ts";
import {
  chatSetup,
  openChat,
  awaited,
  context,
  createConversation,
  eventually,
} from "./support.ts";

const TestDoc = defineDoc<Counter>({
  kind: "test.retention.harness",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ count: 0 }),
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
  const settings: { -readonly [K in keyof HarnessSettings]: HarnessSettings[K] } = setup.settings;
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
  const sizesOf = () => (harness as unknown as SessionImpl).documentCacheSizes;
  expect(sizesOf().cached).toBeGreaterThan(0);
  settings.documentRetentionMs = 0;
  yield* awaited(harness.snapshot(TestDoc, root.id, context));
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited((harness as unknown as SessionImpl).readOnLine(() => Promise.resolve()));
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
