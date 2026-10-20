import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type srcTypes from "../src/index.types.ts";
import runtimeKit from "./runtime-kit.ts";

const { createFauxRuntime, disposeRuntimes } = runtimeKit;

const { awaited, runTest } = testing;

type RecordedSessionEvent =
  | srcTypes.SessionBeforeSwitchEvent
  | srcTypes.SessionBeforeForkEvent
  | srcTypes.SessionShutdownEvent
  | srcTypes.SessionStartEvent;

const createRuntimeHost = (extensionFactory: srcTypes.ExtensionFactory) =>
  runTest(
    Effect.map(
      createFauxRuntime({ extensionFactory, providerViaExtension: false }),
      ({ faux, runtime }) => ({ faux, runtimeHost: runtime }),
    ),
  );

const emitsSessionBeforeSwitchAndSessionStartPart1 = () =>
  Effect.gen(function* () {
    const events: RecordedSessionEvent[] = [];
    const { runtimeHost } = yield* awaited(
      createRuntimeHost((msa) => {
        msa.on("session_before_switch", (event) => {
          events.push(event);
        });
        msa.on("session_shutdown", (event) => {
          events.push(event);
        });
        msa.on("session_start", (event) => {
          events.push(event);
        });
      }),
    );

    expect(events).toEqual([{ reason: "startup", type: "session_start" as const }]);
    events.length = 0;

    yield* awaited(runtimeHost.session.prompt("hello"));
    return { events, runtimeHost };
  });

const emitsSessionBeforeSwitchAndSessionStart = Effect.gen(function* () {
  const { events, runtimeHost } = yield* emitsSessionBeforeSwitchAndSessionStartPart1();
  const originalSessionFile = runtimeHost.session.sessionFile;
  expect(originalSessionFile).toBeTruthy();

  const newSessionResult = yield* awaited(runtimeHost.newSession());
  expect(newSessionResult.cancelled).toBe(false);
  yield* awaited(runtimeHost.session.bindExtensions({}));
  const secondSessionFile = runtimeHost.session.sessionFile;
  expect(events).toEqual([
    { reason: "new", targetSessionFile: undefined, type: "session_before_switch" as const },
    {
      reason: "new",
      targetSessionFile: secondSessionFile,
      type: "session_shutdown" as const,
    },
    {
      previousSessionFile: originalSessionFile,
      reason: "new",
      type: "session_start" as const,
    },
  ]);

  events.length = 0;
  expect(secondSessionFile).toBeTruthy();

  const switchResult = yield* awaited(runtimeHost.switchSession(originalSessionFile!));
  expect(switchResult.cancelled).toBe(false);
  yield* awaited(runtimeHost.session.bindExtensions({}));
  expect(events).toEqual([
    {
      reason: "resume",
      targetSessionFile: originalSessionFile,
      type: "session_before_switch" as const,
    },
    {
      reason: "resume",
      targetSessionFile: originalSessionFile,
      type: "session_shutdown" as const,
    },
    {
      previousSessionFile: secondSessionFile,
      reason: "resume",
      type: "session_start" as const,
    },
  ]);
});

const honorsSessionBeforeSwitchCancellation = Effect.gen(function* () {
  const events: RecordedSessionEvent[] = [];
  const { runtimeHost } = yield* awaited(
    createRuntimeHost((msa) => {
      msa.on("session_before_switch", (event) => {
        events.push(event);
        return { cancel: true };
      });
      msa.on("session_start", (event) => {
        events.push(event);
      });
    }),
  );

  expect(events).toEqual([{ reason: "startup", type: "session_start" as const }]);
  events.length = 0;

  yield* awaited(runtimeHost.session.prompt("hello"));
  const originalSessionFile = runtimeHost.session.sessionFile;

  const result = yield* awaited(runtimeHost.newSession());
  expect(result.cancelled).toBe(true);
  expect(runtimeHost.session.sessionFile).toBe(originalSessionFile);
  expect(events).toEqual([
    { reason: "new", targetSessionFile: undefined, type: "session_before_switch" as const },
  ]);
});

const afterEachHook = disposeRuntimes;

describe("AgentSessionRuntime session lifecycle events", () => {
  afterEach(() => runTest(afterEachHook));
  it("emits session_before_switch and session_start for new and resume flows", () =>
    runTest(emitsSessionBeforeSwitchAndSessionStart));
  it("honors session_before_switch cancellation", () =>
    runTest(honorsSessionBeforeSwitchCancellation));
});
