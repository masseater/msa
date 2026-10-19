import { tmpdir } from "node:os";

import { fauxAssistantMessage, registerFauxProvider } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  randomSuffix,
  pathExists,
  makeDirectory,
  removePath,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import type {
  ExtensionFactory,
  SessionBeforeForkEvent,
  SessionBeforeSwitchEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "../src/index.ts";

type RecordedSessionEvent =
  | SessionBeforeSwitchEvent
  | SessionBeforeForkEvent
  | SessionShutdownEvent
  | SessionStartEvent;

describe("AgentSessionRuntime session lifecycle events", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        while (cleanups.length > 0) {
          yield* awaited(cleanups.pop()?.());
        }
      }),
    ),
  );
  function createRuntimeHost(extensionFactory: ExtensionFactory) {
    return runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const tempDir = joinPath(
          tmpdir(),
          `msa-runtime-events-${currentTimeMillis()}-${yield* randomSuffix}`,
        );
        yield* makeDirectory(tempDir);

        const faux = registerFauxProvider();
        faux.setResponses([
          fauxAssistantMessage("one"),
          fauxAssistantMessage("two"),
          fauxAssistantMessage("three"),
        ]);

        const authStorage = AuthStorage.inMemory();
        yield* awaited(
          authStorage.modify(faux.getModel().provider, () =>
            effectRunPromise(
              awaited({
                type: "api_key" as const,
                key: "faux-key",
              }),
            ),
          ),
        );
        const modelRuntime = yield* awaited(
          ModelRuntime.create({
            credentials: authStorage,
            modelsPath: joinPath(tempDir, "models.json"),
          }),
        );
        const model = faux.getModel();
        modelRuntime.registerProvider(model.provider, {
          baseUrl: model.baseUrl,
          api: model.api,
          models: [
            {
              id: model.id,
              name: model.name,
              api: model.api,
              reasoning: model.reasoning,
              input: model.input,
              cost: model.cost,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
              baseUrl: model.baseUrl,
            },
          ],
        });

        const runtimeOptions = {
          agentDir: tempDir,
          modelRuntime,
          model: faux.getModel(),
          resourceLoaderOptions: {
            extensionFactories: [extensionFactory],
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
          effectRunPromise(
            Effect.gen(function* () {
              const services = yield* awaited(
                createAgentSessionServices({
                  ...runtimeOptions,
                  cwd,
                }),
              );
              return yield* awaited({
                ...(yield* awaited(
                  createAgentSessionFromServices({
                    services,
                    sessionManager,
                    ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
                    model: faux.getModel(),
                  }),
                )),
                services,
                diagnostics: services.diagnostics,
              });
            }),
          );
        const runtimeHost = yield* awaited(
          createAgentSessionRuntime(createRuntime, {
            cwd: tempDir,
            agentDir: tempDir,
            sessionManager: SessionManager.create(tempDir),
          }),
        );
        yield* awaited(runtimeHost.session.bindExtensions({}));

        cleanups.push(() =>
          effectRunPromise(
            Effect.gen(function* () {
              yield* awaited(runtimeHost.dispose());
              faux.unregister();
              if (yield* pathExists(tempDir)) {
                yield* removePath(tempDir);
              }
            }),
          ),
        );

        return yield* awaited({ runtimeHost, faux });
      }),
    );
  }
  it("emits session_before_fork and session_start and honors cancellation", () =>
    runTest(
      Effect.gen(function* () {
        const events: RecordedSessionEvent[] = [];
        let cancelNextFork = false;
        const { runtimeHost } = yield* awaited(
          createRuntimeHost((msa) => {
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

        expect(events).toEqual([{ type: "session_start" as const, reason: "startup" }]);
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
            type: "session_before_fork" as const,
            entryId: userMessage.entryId,
            position: "before",
          },
          {
            type: "session_shutdown" as const,
            reason: "fork",
            targetSessionFile: runtimeHost.session.sessionFile,
          },
          { type: "session_start" as const, reason: "fork", previousSessionFile },
        ]);

        events.length = 0;
        cancelNextFork = true;
        const cancelResult = yield* awaited(runtimeHost.fork(userMessage.entryId));
        expect(cancelResult).toEqual({ cancelled: true });
        expect(events).toEqual([
          {
            type: "session_before_fork" as const,
            entryId: userMessage.entryId,
            position: "before",
          },
        ]);

        events.length = 0;
        cancelNextFork = true;
        const cancelAtResult = yield* awaited(
          runtimeHost.fork("missing-entry", { position: "at" }),
        );
        expect(cancelAtResult).toEqual({ cancelled: true });
        expect(events).toEqual([
          { type: "session_before_fork" as const, entryId: "missing-entry", position: "at" },
        ]);
      }),
    ));
});
