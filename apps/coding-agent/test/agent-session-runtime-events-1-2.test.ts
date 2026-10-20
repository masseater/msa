import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type {
  ExtensionFactory,
  SessionBeforeForkEvent,
  SessionBeforeSwitchEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "../src/index.ts";
import runtimeKit from "./runtime-kit.ts";

const { createFauxRuntime, disposeRuntimes } = runtimeKit;

const { awaited, runTest } = testing;

type RecordedSessionEvent =
  | SessionBeforeSwitchEvent
  | SessionBeforeForkEvent
  | SessionShutdownEvent
  | SessionStartEvent;

const createRuntimeHost = (extensionFactory: ExtensionFactory) =>
  runTest(
    Effect.map(
      createFauxRuntime({ extensionFactory, providerViaExtension: false }),
      ({ faux, runtime }) => ({ faux, runtimeHost: runtime }),
    ),
  );

const forkRecorder =
  (events: RecordedSessionEvent[], control: { cancelNext: boolean }): ExtensionFactory =>
  (msa) => {
    msa.on("session_before_fork", (event) => {
      events.push(event);
      if (!control.cancelNext) return undefined;
      control.cancelNext = false;
      return { cancel: true };
    });
    msa.on("session_shutdown", (event) => {
      events.push(event);
    });
    msa.on("session_start", (event) => {
      events.push(event);
    });
  };

const emitsSessionBeforeForkAndSessionStartStep1 = () =>
  Effect.gen(function* () {
    const events: RecordedSessionEvent[] = [];
    const control = { cancelNext: false };
    const { runtimeHost } = yield* awaited(createRuntimeHost(forkRecorder(events, control)));

    expect(events).toEqual([{ reason: "startup", type: "session_start" as const }]);
    events.length = 0;

    yield* awaited(runtimeHost.session.prompt("hello"));
    const userMessage = runtimeHost.session.getUserMessagesForForking()[0];
    if (userMessage === undefined) throw new Error("expected a user message to fork from");
    const previousSessionFile = runtimeHost.session.sessionFile;

    const successResult = yield* awaited(runtimeHost.fork(userMessage.entryId));
    expect(successResult.cancelled).toBe(false);
    expect(successResult.selectedText).toBe("hello");
    yield* awaited(runtimeHost.session.bindExtensions({}));
    expect(events).toEqual([
      {
        entryId: userMessage.entryId,
        position: "before",
        type: "session_before_fork" as const,
      },
      {
        reason: "fork",
        targetSessionFile: runtimeHost.session.sessionFile,
        type: "session_shutdown" as const,
      },
      { previousSessionFile, reason: "fork", type: "session_start" as const },
    ]);

    events.length = 0;
    control.cancelNext = true;
    const cancelResult = yield* awaited(runtimeHost.fork(userMessage.entryId));
    expect(cancelResult).toEqual({ cancelled: true });
    expect(events).toEqual([
      {
        entryId: userMessage.entryId,
        position: "before",
        type: "session_before_fork" as const,
      },
    ]);

    events.length = 0;
    control.cancelNext = true;
    return { events, runtimeHost };
  });

const emitsSessionBeforeForkAndSessionStart = Effect.gen(function* () {
  const { events, runtimeHost } = yield* emitsSessionBeforeForkAndSessionStartStep1();
  const cancelAtResult = yield* awaited(runtimeHost.fork("missing-entry", { position: "at" }));
  expect(cancelAtResult).toEqual({ cancelled: true });
  expect(events).toEqual([
    { entryId: "missing-entry", position: "at", type: "session_before_fork" as const },
  ]);
});

const afterEachHook = disposeRuntimes;

describe("AgentSessionRuntime session lifecycle events", () => {
  afterEach(() => runTest(afterEachHook));
  it("emits session_before_fork and session_start and honors cancellation", () =>
    runTest(emitsSessionBeforeForkAndSessionStart));
});
