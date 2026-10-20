import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type agentSessionRuntimeTypes from "../../src/core/agent-session-runtime.types.ts";
import type agentSessionTypes from "../../src/core/agent-session.types.ts";
import SessionManager from "../../src/core/session-manager.ts";
import type srcTypes from "../../src/index.types.ts";
import agentSessionRuntimeSupport from "./agent-session-runtime-support.ts";
const { fauxAssistantMessage, fauxToolCall } = compat;

const { createRuntimeForTest, disposeRuntimes } = agentSessionRuntimeSupport;

const {
  deferredPromise,
  gate,
  joinPath,
  makeDirectory,
  nowIso,
  readTextFile,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

type RecordedSessionEvent =
  | srcTypes.SessionBeforeSwitchEvent
  | srcTypes.SessionBeforeForkEvent
  | srcTypes.SessionShutdownEvent
  | srcTypes.SessionStartEvent;

const persistsMessageEndAssistantReplacementsTo = Effect.gen(function* () {
  const { runtime } = yield* createRuntimeForTest((msa: srcTypes.ExtensionAPI) => {
    msa.on("message_end", (event) => {
      if (event.message.role !== "assistant") return;

      return {
        message: {
          ...event.message,
          usage: {
            ...event.message.usage,
            cost: {
              ...event.message.usage.cost,
              total: 0.123,
            },
          },
        },
      };
    });
  });

  yield* Effect.promise(() => runtime.session.run.prompting.prompt("hello"));

  const sessionAssistant = runtime.session.messages.find((message) => message.role === "assistant");
  expect(sessionAssistant?.role).toBe("assistant");
  if (sessionAssistant?.role !== "assistant") {
    throw new Error("missing assistant message");
  }
  expect(sessionAssistant.usage.cost.total).toBe(0.123);

  const persistedAssistant = runtime.session.sessionManager
    .getEntries()
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message)
    .find((message) => message.role === "assistant");
  expect(persistedAssistant?.role).toBe("assistant");
  if (persistedAssistant?.role !== "assistant") {
    throw new Error("missing persisted assistant message");
  }
  expect(persistedAssistant.usage.cost.total).toBe(0.123);
});

const settlesTheActiveResponseBeforeSession = Effect.gen(function* () {
  const toolStartedPromise = gate();
  const { runtime, faux } = yield* createRuntimeForTest((msa: srcTypes.ExtensionAPI) => {
    msa.registerTool({
      description: "Blocks until aborted",
      execute: (_toolCallId, _params, signal) => {
        const aborted = deferredPromise<srcTypes.AgentToolResult<unknown>>();
        toolStartedPromise.release();
        signal?.addEventListener("abort", () =>
          aborted.resolve({ content: [{ text: "tool aborted", type: "text" }], details: {} }),
        );
        return aborted.promise;
      },
      label: "Block",
      name: "block",
      parameters: Type.Object({}),
    });
  });
  yield* Effect.promise(() => runtime.session.run.prompting.prompt("hello"));
  const firstSessionFile = runtime.session.sessionFile!;
  yield* Effect.promise(() => runtime.newSession());
  yield* Effect.promise(() => runtime.session.extensions.binding.bindExtensions({}));
  faux.setResponses([fauxAssistantMessage(fauxToolCall("block", {}), { stopReason: "toolUse" })]);
  const outgoingSession = runtime.session;
  const promptPromise = outgoingSession.run.prompting.prompt("start blocking tool");
  return yield* settlesTheActiveResponseBeforeSessionStep1(
    toolStartedPromise,
    runtime,
    firstSessionFile,
    outgoingSession,
    promptPromise,
  );
});

const settlesTheActiveResponseBeforeSessionStep1 = (
  toolStartedPromise: Promise<void>,
  runtime: agentSessionRuntimeTypes.AgentSessionRuntime,
  firstSessionFile: string,
  outgoingSession: agentSessionTypes.AgentSession,
  promptPromise: Promise<void>,
) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => toolStartedPromise);
    const switchResult = yield* Effect.promise(() => runtime.switchSession(firstSessionFile));
    yield* Effect.promise(() => promptPromise);
    expect(switchResult.cancelled).toBe(false);
    expect(runtime.session.sessionFile).toBe(firstSessionFile);
    const outgoingEntries = SessionManager.open(outgoingSession.sessionFile!)
      .getEntries()
      .filter((entry) => entry.type === "message");
    expect(outgoingEntries.map((entry) => entry.message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
  });

const preservesAnExistingSessionWhenImporting = Effect.gen(function* () {
  const { runtime, tempDir } = yield* createRuntimeForTest(() => {});
  const sessionDir = runtime.session.sessionManager.getSessionDir();
  const importDir = joinPath(tempDir, "import");
  const filename = "collision.jsonl";
  const storedPath = joinPath(sessionDir, filename);
  const importPath = joinPath(importDir, filename);
  const storedSession = `${yield* toJsonText({
    cwd: tempDir,
    id: "stored",
    timestamp: nowIso(),
    type: "session",
    version: 3,
  })}\n`;
  const importedSession = `${yield* toJsonText({
    cwd: tempDir,
    id: "imported",
    timestamp: nowIso(),
    type: "session",
    version: 3,
  })}\n`;
  yield* makeDirectory(sessionDir);
  yield* makeDirectory(importDir);
  yield* writeTextFile(storedPath, storedSession);
  yield* writeTextFile(importPath, importedSession);

  yield* Effect.promise(() => runtime.importFromJsonl(importPath));

  expect(yield* readTextFile(storedPath)).toBe(storedSession);
  expect(runtime.session.sessionFile).not.toBe(storedPath);
  expect(yield* readTextFile(runtime.session.sessionFile!)).toContain('"id":"imported"');
});

const emitsSessionBeforeSwitchAndSession = Effect.gen(function* () {
  const events: RecordedSessionEvent[] = [];
  const { runtime } = yield* createRuntimeForTest((msa: srcTypes.ExtensionAPI) => {
    msa.on("session_before_switch", (event) => {
      events.push(event);
    });
    msa.on("session_shutdown", (event) => {
      events.push(event);
    });
    msa.on("session_start", (event) => {
      events.push(event);
    });
  });
  expect(events).toEqual([{ reason: "startup", type: "session_start" }]);
  events.length = 0;
  yield* Effect.promise(() => runtime.session.run.prompting.prompt("hello"));
  const originalSessionFile = runtime.session.sessionFile;
  const originalSession = runtime.session;
  const newSessionResult = yield* Effect.promise(() => runtime.newSession());
  expect(newSessionResult.cancelled).toBe(false);
  yield* Effect.promise(() => runtime.session.extensions.binding.bindExtensions({}));
  expect(runtime.session).not.toBe(originalSession);
  expect(runtime.session.messages).toEqual([]);
  const secondSessionFile = runtime.session.sessionFile;
  return yield* emitsSessionBeforeSwitchAndSessionStep1(
    events,
    runtime,
    originalSessionFile,
    secondSessionFile,
  );
});

const emitsSessionBeforeSwitchAndSessionStep1 = (
  events: RecordedSessionEvent[],
  runtime: agentSessionRuntimeTypes.AgentSessionRuntime,
  originalSessionFile: string | undefined,
  secondSessionFile: string | undefined,
) =>
  Effect.gen(function* () {
    expect(events).toEqual([
      { reason: "new", targetSessionFile: undefined, type: "session_before_switch" },
      { reason: "new", targetSessionFile: secondSessionFile, type: "session_shutdown" },
      { previousSessionFile: originalSessionFile, reason: "new", type: "session_start" },
    ]);
    events.length = 0;
    const switchResult = yield* Effect.promise(() => runtime.switchSession(originalSessionFile!));
    expect(switchResult.cancelled).toBe(false);
    yield* Effect.promise(() => runtime.session.extensions.binding.bindExtensions({}));
    expect(events).toEqual([
      {
        reason: "resume",
        targetSessionFile: originalSessionFile,
        type: "session_before_switch",
      },
      { reason: "resume", targetSessionFile: originalSessionFile, type: "session_shutdown" },
      { previousSessionFile: secondSessionFile, reason: "resume", type: "session_start" },
    ]);
  });

const persistsMessageEndAssistantReplacementsToThe = () =>
  runTest(persistsMessageEndAssistantReplacementsTo);

const settlesTheActiveResponseBeforeSessionReplacement = () =>
  runTest(settlesTheActiveResponseBeforeSession);

const preservesAnExistingSessionWhenImportingA = () =>
  runTest(preservesAnExistingSessionWhenImporting);

const emitsSessionBeforeSwitchAndSessionStart = () => runTest(emitsSessionBeforeSwitchAndSession);

const afterEachHook = () => runTest(disposeRuntimes);

describe("AgentSessionRuntime characterization", () => {
  afterEach(afterEachHook);

  it(
    "persists message_end assistant replacements to the session manager",
    persistsMessageEndAssistantReplacementsToThe,
  );

  it(
    "settles the active response before session replacement",
    settlesTheActiveResponseBeforeSessionReplacement,
  );

  it(
    "preserves an existing session when importing a file with the same name",
    preservesAnExistingSessionWhenImportingA,
  );

  it(
    "emits session_before_switch and session_start for new and resume flows",
    emitsSessionBeforeSwitchAndSessionStart,
  );
});
