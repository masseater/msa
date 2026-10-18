import * as NodeServices from "@effect/platform-node/NodeServices";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@msa/ai/compat";
import { basenameOf, currentTimeMillis, gate, joinPath, nowIso, toJsonText } from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { AgentSession } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
  SessionBeforeForkEvent,
  SessionBeforeSwitchEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "../../src/index.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

type RecordedSessionEvent =
  | SessionBeforeSwitchEvent
  | SessionBeforeForkEvent
  | SessionShutdownEvent
  | SessionStartEvent;

const cleanups: Array<() => Promise<void> | void> = [];

function createRuntimeForTest(
  extensionFactory: ExtensionFactory,
  options?: { cwd?: string; bootstrapModel?: boolean; bootstrapThinkingLevel?: boolean },
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const tempDir =
        options?.cwd ?? (yield* fs.makeTempDirectory({ prefix: `msa-runtime-suite-` }));
      yield* fs.makeDirectory(tempDir, { recursive: true });

      const faux = registerFauxProvider({
        models: [
          { id: "faux-1", reasoning: true },
          { id: "faux-2", reasoning: false },
        ],
      });
      faux.setResponses([
        fauxAssistantMessage("one"),
        fauxAssistantMessage("two"),
        fauxAssistantMessage("three"),
      ]);

      const authStorage = AuthStorage.inMemory();
      yield* Effect.promise(() =>
        authStorage.modify(faux.getModel().provider, () =>
          Promise.resolve({
            type: "api_key",
            key: "faux-key",
          }),
        ),
      );

      const runtimeOptions = {
        agentDir: tempDir,
        authStorage,
        model: options?.bootstrapModel === false ? undefined : faux.getModel(),
        thinkingLevel: options?.bootstrapThinkingLevel === false ? undefined : undefined,
        resourceLoaderOptions: {
          extensionFactories: [
            (msa: ExtensionAPI) => {
              msa.registerProvider(faux.getModel().provider, {
                baseUrl: faux.getModel().baseUrl,
                apiKey: "faux-key",
                api: faux.api,
                models: faux.models.map((registeredModel) => ({
                  id: registeredModel.id,
                  name: registeredModel.name,
                  api: registeredModel.api,
                  reasoning: registeredModel.reasoning,
                  input: registeredModel.input,
                  cost: registeredModel.cost,
                  contextWindow: registeredModel.contextWindow,
                  maxTokens: registeredModel.maxTokens,
                })),
              });
              extensionFactory(msa);
            },
          ],
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
        },
      };
      const createRuntime: CreateAgentSessionRuntimeFactory = ({
        cwd,
        sessionManager,
        sessionStartEvent,
      }) =>
        runPromise(
          Effect.gen(function* () {
            const services = yield* Effect.promise(() =>
              createAgentSessionServices({
                ...runtimeOptions,
                cwd,
              }),
            );
            return {
              ...(yield* Effect.promise(() =>
                createAgentSessionFromServices({
                  services,
                  sessionManager,
                  ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
                  ...(runtimeOptions.model === undefined ? {} : { model: runtimeOptions.model }),
                  ...(runtimeOptions.thinkingLevel === undefined
                    ? {}
                    : { thinkingLevel: runtimeOptions.thinkingLevel }),
                }),
              )),
              services,
              diagnostics: services.diagnostics,
            };
          }),
        );
      const runtime = yield* Effect.promise(() =>
        createAgentSessionRuntime(createRuntime, {
          cwd: tempDir,
          agentDir: tempDir,
          sessionManager: SessionManager.create(tempDir),
        }),
      );
      yield* Effect.promise(() => runtime.session.bindExtensions({}));

      cleanups.push(() =>
        runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() => runtime.dispose());
            faux.unregister();
            if (yield* fs.exists(tempDir)) {
              yield* fs.remove(tempDir, { recursive: true, force: true });
            }
          }),
        ),
      );

      return { runtime, faux, tempDir };
    }),
  );
}

const persistsMessageEndAssistantReplacementsTo = Effect.gen(function* () {
  const { runtime } = yield* Effect.promise(() =>
    createRuntimeForTest((msa: ExtensionAPI) => {
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
    }),
  );

  yield* Effect.promise(() => runtime.session.prompt("hello"));

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
  const { runtime, faux } = yield* Effect.promise(() =>
    createRuntimeForTest((msa: ExtensionAPI) => {
      msa.registerTool({
        name: "block",
        label: "Block",
        description: "Blocks until aborted",
        parameters: Type.Object({}),
        execute: (_toolCallId, _params, signal) =>
          new Promise<AgentToolResult<unknown>>((resolve) => {
            toolStartedPromise.release();
            signal?.addEventListener("abort", () =>
              resolve({ content: [{ type: "text", text: "tool aborted" }], details: {} }),
            );
          }),
      });
    }),
  );
  yield* Effect.promise(() => runtime.session.prompt("hello"));
  const firstSessionFile = runtime.session.sessionFile!;
  yield* Effect.promise(() => runtime.newSession());
  yield* Effect.promise(() => runtime.session.bindExtensions({}));
  faux.setResponses([fauxAssistantMessage(fauxToolCall("block", {}), { stopReason: "toolUse" })]);
  const outgoingSession = runtime.session;
  const promptPromise = outgoingSession.prompt("start blocking tool");
  return yield* settlesTheActiveResponseBeforeSessionPart2(
    toolStartedPromise,
    runtime,
    firstSessionFile,
    outgoingSession,
    promptPromise,
  );
});

const settlesTheActiveResponseBeforeSessionPart2 = (
  toolStartedPromise: Promise<void>,
  runtime: AgentSessionRuntime,
  firstSessionFile: string,
  outgoingSession: AgentSession,
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
  const { runtime, tempDir } = yield* Effect.promise(() => createRuntimeForTest(() => {}));
  const sessionDir = runtime.session.sessionManager.getSessionDir();
  const importDir = joinPath(tempDir, "import");
  const filename = "collision.jsonl";
  const storedPath = joinPath(sessionDir, filename);
  const importPath = joinPath(importDir, filename);
  const storedSession = `${yield* toJsonText({
    type: "session",
    version: 3,
    id: "stored",
    timestamp: nowIso(),
    cwd: tempDir,
  })}\n`;
  const importedSession = `${yield* toJsonText({
    type: "session",
    version: 3,
    id: "imported",
    timestamp: nowIso(),
    cwd: tempDir,
  })}\n`;
  yield* fs.makeDirectory(sessionDir, { recursive: true });
  yield* fs.makeDirectory(importDir, { recursive: true });
  yield* fs.writeFileString(storedPath, storedSession);
  yield* fs.writeFileString(importPath, importedSession);

  yield* Effect.promise(() => runtime.importFromJsonl(importPath));

  expect(yield* fs.readFileString(storedPath)).toBe(storedSession);
  expect(runtime.session.sessionFile).not.toBe(storedPath);
  expect(yield* fs.readFileString(runtime.session.sessionFile!)).toContain('"id":"imported"');
});

const emitsSessionBeforeSwitchAndSession = Effect.gen(function* () {
  const events: RecordedSessionEvent[] = [];
  const { runtime } = yield* Effect.promise(() =>
    createRuntimeForTest((msa: ExtensionAPI) => {
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
  expect(events).toEqual([{ type: "session_start", reason: "startup" }]);
  events.length = 0;
  yield* Effect.promise(() => runtime.session.prompt("hello"));
  const originalSessionFile = runtime.session.sessionFile;
  const originalSession = runtime.session;
  const newSessionResult = yield* Effect.promise(() => runtime.newSession());
  expect(newSessionResult.cancelled).toBe(false);
  yield* Effect.promise(() => runtime.session.bindExtensions({}));
  expect(runtime.session).not.toBe(originalSession);
  expect(runtime.session.messages).toEqual([]);
  const secondSessionFile = runtime.session.sessionFile;
  return yield* emitsSessionBeforeSwitchAndSessionPart2(
    events,
    runtime,
    originalSessionFile,
    secondSessionFile,
  );
});

const emitsSessionBeforeSwitchAndSessionPart2 = (
  events: RecordedSessionEvent[],
  runtime: AgentSessionRuntime,
  originalSessionFile: string | undefined,
  secondSessionFile: string | undefined,
) =>
  Effect.gen(function* () {
    expect(events).toEqual([
      { type: "session_before_switch", reason: "new", targetSessionFile: undefined },
      { type: "session_shutdown", reason: "new", targetSessionFile: secondSessionFile },
      { type: "session_start", reason: "new", previousSessionFile: originalSessionFile },
    ]);
    events.length = 0;
    const switchResult = yield* Effect.promise(() => runtime.switchSession(originalSessionFile!));
    expect(switchResult.cancelled).toBe(false);
    yield* Effect.promise(() => runtime.session.bindExtensions({}));
    expect(events).toEqual([
      {
        type: "session_before_switch",
        reason: "resume",
        targetSessionFile: originalSessionFile,
      },
      { type: "session_shutdown", reason: "resume", targetSessionFile: originalSessionFile },
      { type: "session_start", reason: "resume", previousSessionFile: secondSessionFile },
    ]);
  });

const honorsSessionBeforeSwitchCancellationFor = Effect.gen(function* () {
  const events: RecordedSessionEvent[] = [];
  let cancelReason: "new" | "resume" | undefined;
  const { runtime } = yield* Effect.promise(() =>
    createRuntimeForTest((msa: ExtensionAPI) => {
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
    }),
  );

  yield* Effect.promise(() => runtime.session.prompt("hello"));
  const originalSessionFile = runtime.session.sessionFile;

  cancelReason = "new";
  const newResult = yield* Effect.promise(() => runtime.newSession());
  expect(newResult.cancelled).toBe(true);
  expect(runtime.session.sessionFile).toBe(originalSessionFile);

  events.length = 0;
  const otherDir = yield* fs.makeTempDirectory({ prefix: `msa-runtime-other-` });
  yield* fs.makeDirectory(otherDir, { recursive: true });
  const otherSession = SessionManager.create(otherDir);
  otherSession.appendMessage({
    role: "user",
    content: [{ type: "text", text: "other" }],
    timestamp: currentTimeMillis(),
  });
  const otherSessionFile = otherSession.getSessionFile();
  cancelReason = "resume";
  const resumeResult = yield* Effect.promise(() => runtime.switchSession(otherSessionFile!));
  expect(resumeResult.cancelled).toBe(true);
  expect(runtime.session.sessionFile).toBe(originalSessionFile);
});

const emitsSessionBeforeForkAndSession = Effect.gen(function* () {
  const events: RecordedSessionEvent[] = [];
  let cancelNextFork = false;
  const { runtime } = yield* Effect.promise(() =>
    createRuntimeForTest((msa: ExtensionAPI) => {
      msa.on("session_before_fork", (event) => {
        events.push(event);
        if (cancelNextFork) {
          cancelNextFork = false;
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
    }),
  );

  events.length = 0;
  yield* Effect.promise(() => runtime.session.prompt("hello"));
  const userMessage = runtime.session.getUserMessagesForForking()[0]!;
  const previousSessionFile = runtime.session.sessionFile;

  const successResult = yield* Effect.promise(() => runtime.fork(userMessage.entryId));
  expect(successResult.cancelled).toBe(false);
  expect(successResult.selectedText).toBe("hello");
  yield* Effect.promise(() => runtime.session.bindExtensions({}));
  expect(events).toEqual([
    { type: "session_before_fork", entryId: userMessage.entryId, position: "before" },
    {
      type: "session_shutdown",
      reason: "fork",
      targetSessionFile: runtime.session.sessionFile,
    },
    { type: "session_start", reason: "fork", previousSessionFile },
  ]);
  const sessionFileName = basenameOf(runtime.session.sessionFile!).replace(/\.[^.]*$/u, "");
  expect(sessionFileName.endsWith(`_${runtime.session.sessionId}`)).toBe(true);

  events.length = 0;
  cancelNextFork = true;
  const cancelResult = yield* Effect.promise(() => runtime.fork(userMessage.entryId));
  expect(cancelResult).toEqual({ cancelled: true });
  expect(events).toEqual([
    { type: "session_before_fork", entryId: userMessage.entryId, position: "before" },
  ]);

  events.length = 0;
  cancelNextFork = true;
  const cancelAtResult = yield* Effect.promise(() =>
    runtime.fork("missing-entry", { position: "at" }),
  );
  expect(cancelAtResult).toEqual({ cancelled: true });
  expect(events).toEqual([
    { type: "session_before_fork", entryId: "missing-entry", position: "at" },
  ]);
});

const reportsWhyAnUnflushedSessionCannot = Effect.gen(function* () {
  const { runtime } = yield* Effect.promise(() => createRuntimeForTest(() => {}));
  const sessionFile = runtime.session.sessionFile;
  const leafId = runtime.session.sessionManager.getLeafId();
  expect(sessionFile).toBeDefined();
  expect(yield* fs.exists(sessionFile!)).toBe(false);
  expect(leafId).toBeTruthy();

  yield* Effect.promise(() =>
    expect(runtime.fork(leafId!, { position: "at" })).rejects.toThrow(
      "This session has not been saved yet. Send a message before cloning or forking it.",
    ),
  );
});

const duplicatesTheCurrentActiveBranchWhen = Effect.gen(function* () {
  const { runtime } = yield* Effect.promise(() => createRuntimeForTest(() => {}));
  yield* Effect.promise(() => runtime.session.prompt("hello"));
  yield* Effect.promise(() => runtime.session.prompt("again"));

  const beforeMessages = runtime.session.messages.map((message) => ({
    role: message.role,
    text:
      message.role === "user"
        ? typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part): part is { type: "text"; text: string } => part.type === "text")
              .map((part) => part.text)
              .join("")
        : undefined,
  }));
  const previousSessionFile = runtime.session.sessionFile;
  const leafId = runtime.session.sessionManager.getLeafId();
  expect(leafId).toBeTruthy();

  const result = yield* Effect.promise(() => runtime.fork(leafId!, { position: "at" }));
  expect(result).toEqual({ cancelled: false, selectedText: undefined });
  expect(runtime.session.sessionFile).not.toBe(previousSessionFile);
  expect(
    runtime.session.messages.map((message) => ({
      role: message.role,
      text:
        message.role === "user"
          ? typeof message.content === "string"
            ? message.content
            : message.content
                .filter((part): part is { type: "text"; text: string } => part.type === "text")
                .map((part) => part.text)
                .join("")
          : undefined,
    })),
  ).toEqual(beforeMessages);
});

const duplicatesTheCurrentActiveBranchIn = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const tempDir = yield* fs.makeTempDirectory({ prefix: `msa-runtime-suite-in-memory-` });
  yield* fs.makeDirectory(tempDir, { recursive: true });

  const faux = registerFauxProvider({
    models: [
      { id: "faux-1", reasoning: true },
      { id: "faux-2", reasoning: false },
    ],
  });
  faux.setResponses([
    fauxAssistantMessage("one"),
    fauxAssistantMessage("two"),
    fauxAssistantMessage("three"),
  ]);

  const authStorage = AuthStorage.inMemory();
  yield* Effect.promise(() =>
    authStorage.modify(faux.getModel().provider, () =>
      Promise.resolve({
        type: "api_key",
        key: "faux-key",
      }),
    ),
  );

  const runtimeOptions = {
    agentDir: tempDir,
    authStorage,
    model: faux.getModel(),
    resourceLoaderOptions: {
      extensionFactories: [
        (msa: ExtensionAPI) => {
          msa.registerProvider(faux.getModel().provider, {
            baseUrl: faux.getModel().baseUrl,
            apiKey: "faux-key",
            api: faux.api,
            models: faux.models.map((registeredModel) => ({
              id: registeredModel.id,
              name: registeredModel.name,
              api: registeredModel.api,
              reasoning: registeredModel.reasoning,
              input: registeredModel.input,
              cost: registeredModel.cost,
              contextWindow: registeredModel.contextWindow,
              maxTokens: registeredModel.maxTokens,
            })),
          });
        },
      ],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    },
  };
  const createRuntime: CreateAgentSessionRuntimeFactory = ({
    cwd,
    sessionManager,
    sessionStartEvent,
  }) =>
    runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.promise(() =>
          createAgentSessionServices({
            ...runtimeOptions,
            cwd,
          }),
        );
        return {
          ...(yield* Effect.promise(() =>
            createAgentSessionFromServices({
              services,
              sessionManager,
              ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
              model: runtimeOptions.model,
            }),
          )),
          services,
          diagnostics: services.diagnostics,
        };
      }),
    );
  const runtime = yield* Effect.promise(() =>
    createAgentSessionRuntime(createRuntime, {
      cwd: tempDir,
      agentDir: tempDir,
      sessionManager: SessionManager.inMemory(tempDir),
    }),
  );
  yield* Effect.promise(() => runtime.session.bindExtensions({}));
  cleanups.push(() =>
    runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => runtime.dispose());
        faux.unregister();
        if (yield* fs.exists(tempDir)) {
          yield* fs.remove(tempDir, { recursive: true, force: true });
        }
      }),
    ),
  );

  yield* Effect.promise(() => runtime.session.prompt("hello"));
  yield* Effect.promise(() => runtime.session.prompt("again"));

  const beforeMessages = runtime.session.messages.map((message) => ({
    role: message.role,
    text:
      message.role === "user"
        ? typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part): part is { type: "text"; text: string } => part.type === "text")
              .map((part) => part.text)
              .join("")
        : undefined,
  }));
  const leafId = runtime.session.sessionManager.getLeafId();
  expect(leafId).toBeTruthy();
  expect(runtime.session.sessionFile).toBeUndefined();

  const result = yield* Effect.promise(() => runtime.fork(leafId!, { position: "at" }));
  expect(result).toEqual({ cancelled: false, selectedText: undefined });
  expect(runtime.session.sessionFile).toBeUndefined();
  expect(
    runtime.session.messages.map((message) => ({
      role: message.role,
      text:
        message.role === "user"
          ? typeof message.content === "string"
            ? message.content
            : message.content
                .filter((part): part is { type: "text"; text: string } => part.type === "text")
                .map((part) => part.text)
                .join("")
          : undefined,
    })),
  ).toEqual(beforeMessages);
});

const throwsWhenForkingWithAnInvalid = Effect.gen(function* () {
  const { runtime } = yield* Effect.promise(() => createRuntimeForTest(() => {}));
  yield* Effect.promise(() =>
    expect(runtime.fork("missing-entry")).rejects.toThrow("Invalid entry ID for forking"),
  );
});

const updatesTheRuntimeSessionCwdOn = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const firstDir = yield* fs.makeTempDirectory({ prefix: `msa-runtime-cwd-a-` });
  const secondDir = yield* fs.makeTempDirectory({ prefix: `msa-runtime-cwd-b-` });
  yield* fs.makeDirectory(firstDir, { recursive: true });
  yield* fs.makeDirectory(secondDir, { recursive: true });
  const { runtime, faux, tempDir } = yield* Effect.promise(() =>
    createRuntimeForTest(() => {}, { cwd: firstDir }),
  );
  const otherAuthStorage = AuthStorage.inMemory();
  yield* Effect.promise(() =>
    otherAuthStorage.modify(faux.getModel().provider, () =>
      Promise.resolve({
        type: "api_key",
        key: "faux-key",
      }),
    ),
  );
  const otherRuntimeOptions = {
    agentDir: tempDir,
    authStorage: otherAuthStorage,
    resourceLoaderOptions: {
      extensionFactories: [
        (msa: ExtensionAPI) => {
          msa.registerProvider(faux.getModel().provider, {
            baseUrl: faux.getModel().baseUrl,
            apiKey: "faux-key",
            api: faux.api,
            models: faux.models.map((registeredModel) => ({
              id: registeredModel.id,
              name: registeredModel.name,
              api: registeredModel.api,
              reasoning: registeredModel.reasoning,
              input: registeredModel.input,
              cost: registeredModel.cost,
              contextWindow: registeredModel.contextWindow,
              maxTokens: registeredModel.maxTokens,
            })),
          });
        },
      ],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    },
  };
  const createOtherRuntime: CreateAgentSessionRuntimeFactory = ({
    cwd,
    sessionManager,
    sessionStartEvent,
  }) =>
    runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.promise(() =>
          createAgentSessionServices({
            ...otherRuntimeOptions,
            cwd,
          }),
        );
        return {
          ...(yield* Effect.promise(() =>
            createAgentSessionFromServices({
              services,
              sessionManager,
              ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
            }),
          )),
          services,
          diagnostics: services.diagnostics,
        };
      }),
    );
  const otherRuntime = yield* Effect.promise(() =>
    createAgentSessionRuntime(createOtherRuntime, {
      cwd: secondDir,
      agentDir: tempDir,
      sessionManager: SessionManager.create(secondDir),
    }),
  );
  cleanups.push(() => otherRuntime.dispose());
  yield* Effect.promise(() => otherRuntime.session.prompt("other"));
  const otherSessionFile = otherRuntime.session.sessionFile!;

  yield* Effect.promise(() => runtime.switchSession(otherSessionFile));

  expect(yield* fs.realPath(runtime.session.sessionManager.getCwd())).toBe(
    yield* fs.realPath(secondDir),
  );
  expect(yield* fs.realPath(runtime.cwd)).toBe(yield* fs.realPath(secondDir));
});

const restoresModelAndThinkingStateFrom = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const { runtime, faux, tempDir } = yield* Effect.promise(() =>
    createRuntimeForTest(() => {}, {
      bootstrapModel: false,
      bootstrapThinkingLevel: false,
    }),
  );
  const otherDir = joinPath(tempDir, "other");
  yield* fs.makeDirectory(otherDir, { recursive: true });
  const otherAuthStorage = AuthStorage.inMemory();
  yield* Effect.promise(() =>
    otherAuthStorage.modify(faux.getModel().provider, () =>
      Promise.resolve({
        type: "api_key",
        key: "faux-key",
      }),
    ),
  );
  const otherRuntimeOptions = {
    agentDir: tempDir,
    authStorage: otherAuthStorage,
    resourceLoaderOptions: {
      extensionFactories: [
        (msa: ExtensionAPI) => {
          msa.registerProvider(faux.getModel().provider, {
            baseUrl: faux.getModel().baseUrl,
            apiKey: "faux-key",
            api: faux.api,
            models: faux.models.map((registeredModel) => ({
              id: registeredModel.id,
              name: registeredModel.name,
              api: registeredModel.api,
              reasoning: registeredModel.reasoning,
              input: registeredModel.input,
              cost: registeredModel.cost,
              contextWindow: registeredModel.contextWindow,
              maxTokens: registeredModel.maxTokens,
            })),
          });
        },
      ],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    },
  };
  const createOtherRuntime: CreateAgentSessionRuntimeFactory = ({
    cwd,
    sessionManager,
    sessionStartEvent,
  }) =>
    runPromise(
      Effect.gen(function* () {
        const services = yield* Effect.promise(() =>
          createAgentSessionServices({
            ...otherRuntimeOptions,
            cwd,
          }),
        );
        return {
          ...(yield* Effect.promise(() =>
            createAgentSessionFromServices({
              services,
              sessionManager,
              ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
            }),
          )),
          services,
          diagnostics: services.diagnostics,
        };
      }),
    );
  const otherRuntime = yield* Effect.promise(() =>
    createAgentSessionRuntime(createOtherRuntime, {
      cwd: otherDir,
      agentDir: tempDir,
      sessionManager: SessionManager.create(otherDir),
    }),
  );
  cleanups.push(() => otherRuntime.dispose());
  yield* Effect.promise(() => otherRuntime.session.setModel(faux.getModel("faux-2")!));
  otherRuntime.session.setThinkingLevel("off");
  yield* Effect.promise(() => otherRuntime.session.prompt("hello"));
  const targetSessionFile = otherRuntime.session.sessionFile!;

  yield* Effect.promise(() => runtime.switchSession(targetSessionFile));

  expect(runtime.session.model?.id).toBe("faux-2");
  expect(runtime.session.thinkingLevel).toBe("off");
});

describe("AgentSessionRuntime characterization", () => {
  afterEach(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        while (cleanups.length > 0) {
          yield* Effect.promise(() => Promise.resolve(cleanups.pop()?.()));
        }
      }),
    ),
  );
  it("persists message_end assistant replacements to the session manager", () =>
    Effect.runPromise(persistsMessageEndAssistantReplacementsTo));
  it("settles the active response before session replacement", () =>
    Effect.runPromise(settlesTheActiveResponseBeforeSession));
  it("preserves an existing session when importing a file with the same name", () =>
    Effect.runPromise(preservesAnExistingSessionWhenImporting));
  it("emits session_before_switch and session_start for new and resume flows", () =>
    Effect.runPromise(emitsSessionBeforeSwitchAndSession));
  it("honors session_before_switch cancellation for new and resume", () =>
    Effect.runPromise(honorsSessionBeforeSwitchCancellationFor));
  it("emits session_before_fork and session_start and honors cancellation", () =>
    Effect.runPromise(emitsSessionBeforeForkAndSession));
  it("reports why an unflushed session cannot be forked", () =>
    Effect.runPromise(reportsWhyAnUnflushedSessionCannot));
  it("duplicates the current active branch when forking at the current position", () =>
    Effect.runPromise(duplicatesTheCurrentActiveBranchWhen));
  it("duplicates the current active branch in-memory when forking at the current position", () =>
    Effect.runPromise(duplicatesTheCurrentActiveBranchIn));
  it("throws when forking with an invalid entry id", () =>
    Effect.runPromise(throwsWhenForkingWithAnInvalid));
  it("updates the runtime session cwd on cross-cwd session replacement", () =>
    Effect.runPromise(updatesTheRuntimeSessionCwdOn));
  it("restores model and thinking state from the destination session", () =>
    Effect.runPromise(restoresModelAndThinkingStateFrom));
});
