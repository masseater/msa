import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SessionManager } from "../../src/core/session-manager.ts";
import type {
  ExtensionAPI,
  SessionBeforeForkEvent,
  SessionBeforeSwitchEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "../../src/index.ts";
import agentSessionRuntimeSupport from "./agent-session-runtime-support.ts";

const { createRuntimeForTest, disposeRuntimes } = agentSessionRuntimeSupport;

const { basenameOf, currentTimeMillis, makeDirectory, makeTempDir, pathExists, runTest } = testing;

type RecordedSessionEvent =
  | SessionBeforeSwitchEvent
  | SessionBeforeForkEvent
  | SessionShutdownEvent
  | SessionStartEvent;

const honorsSessionBeforeSwitchCancellationFor = Effect.gen(function* () {
  const events: RecordedSessionEvent[] = [];
  let cancelReason: "new" | "resume" | undefined;
  const { runtime } = yield* createRuntimeForTest((msa: ExtensionAPI) => {
    msa.on("session_before_switch", (event) => {
      events.push(event);
      if (event.reason === cancelReason) {
        return { cancel: true };
      }
      return undefined;
    });
    msa.on("session_start", (event) => {
      events.push(event);
    });
  });

  yield* Effect.promise(() => runtime.session.prompt("hello"));
  const originalSessionFile = runtime.session.sessionFile;

  cancelReason = "new";
  const newResult = yield* Effect.promise(() => runtime.newSession());
  expect(newResult.cancelled).toBe(true);
  expect(runtime.session.sessionFile).toBe(originalSessionFile);

  events.length = 0;
  const otherDir = yield* makeTempDir("msa-runtime-other-");
  yield* makeDirectory(otherDir);
  const otherSession = SessionManager.create(otherDir);
  otherSession.appendMessage({
    content: [{ text: "other", type: "text" }],
    role: "user",
    timestamp: currentTimeMillis(),
  });
  const otherSessionFile = otherSession.getSessionFile();
  cancelReason = "resume";
  const resumeResult = yield* Effect.promise(() => runtime.switchSession(otherSessionFile!));
  expect(resumeResult.cancelled).toBe(true);
  expect(runtime.session.sessionFile).toBe(originalSessionFile);
});

const forkRecorder =
  (events: RecordedSessionEvent[], control: { cancelNext: boolean }) => (msa: ExtensionAPI) => {
    msa.on("session_before_fork", (event) => {
      events.push(event);
      if (control.cancelNext) {
        control.cancelNext = false;
        return { cancel: true };
      }
      return undefined;
    });
    msa.on("session_shutdown", (event) => {
      events.push(event);
    });
    msa.on("session_start", (event) => {
      events.push(event);
    });
  };

const emitsSessionBeforeForkAndSessionStep1 = () =>
  Effect.gen(function* () {
    const events: RecordedSessionEvent[] = [];
    const control = { cancelNext: false };
    const { runtime } = yield* createRuntimeForTest(forkRecorder(events, control));

    events.length = 0;
    yield* Effect.promise(() => runtime.session.prompt("hello"));
    const userMessage = runtime.session.getUserMessagesForForking()[0]!;
    const previousSessionFile = runtime.session.sessionFile;

    const successResult = yield* Effect.promise(() => runtime.fork(userMessage.entryId));
    expect(successResult.cancelled).toBe(false);
    expect(successResult.selectedText).toBe("hello");
    yield* Effect.promise(() => runtime.session.bindExtensions({}));
    expect(events).toEqual([
      { entryId: userMessage.entryId, position: "before", type: "session_before_fork" },
      {
        reason: "fork",
        targetSessionFile: runtime.session.sessionFile,
        type: "session_shutdown",
      },
      { previousSessionFile, reason: "fork", type: "session_start" },
    ]);
    const sessionFileName = basenameOf(runtime.session.sessionFile!).replace(/\.[^.]*$/u, "");
    expect(sessionFileName.endsWith(`_${runtime.session.sessionId}`)).toBe(true);

    events.length = 0;
    control.cancelNext = true;
    const cancelResult = yield* Effect.promise(() => runtime.fork(userMessage.entryId));
    expect(cancelResult).toEqual({ cancelled: true });
    expect(events).toEqual([
      { entryId: userMessage.entryId, position: "before", type: "session_before_fork" },
    ]);

    events.length = 0;
    control.cancelNext = true;
    return { events, runtime };
  });

const emitsSessionBeforeForkAndSession = Effect.gen(function* () {
  const { events, runtime } = yield* emitsSessionBeforeForkAndSessionStep1();
  const cancelAtResult = yield* Effect.promise(() =>
    runtime.fork("missing-entry", { position: "at" }),
  );
  expect(cancelAtResult).toEqual({ cancelled: true });
  expect(events).toEqual([
    { entryId: "missing-entry", position: "at", type: "session_before_fork" },
  ]);
});

const reportsWhyAnUnflushedSessionCannot = Effect.gen(function* () {
  const { runtime } = yield* createRuntimeForTest(() => {});
  const sessionFile = runtime.session.sessionFile;
  const leafId = runtime.session.sessionManager.getLeafId();
  expect(sessionFile).toBeDefined();
  expect(yield* pathExists(sessionFile!)).toBe(false);
  expect(leafId).toBeTruthy();

  yield* Effect.promise(() =>
    expect(runtime.fork(leafId!, { position: "at" })).rejects.toThrow(
      "This session has not been saved yet. Send a message before cloning or forking it.",
    ),
  );
});

const afterEachHook = () => runTest(disposeRuntimes);

describe("AgentSessionRuntime session replacement", () => {
  afterEach(afterEachHook);

  it("honors session_before_switch cancellation for new and resume", () =>
    runTest(honorsSessionBeforeSwitchCancellationFor));

  it("emits session_before_fork and session_start and honors cancellation", () =>
    runTest(emitsSessionBeforeForkAndSession));

  it("reports why an unflushed session cannot be forked", () =>
    runTest(reportsWhyAnUnflushedSessionCannot));
});
