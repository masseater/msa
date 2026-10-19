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
import type { ExtensionFactory } from "../src/index.ts";

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
  it("runs beforeSessionInvalidate after session_shutdown and before rebindSession", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const phases: string[] = [];
        const { runtimeHost } = yield* awaited(
          createRuntimeHost((msa) => {
            msa.on("session_shutdown", () => {
              phases.push("session_shutdown");
            });
          }),
        );
        const oldSession = runtimeHost.session;
        runtimeHost.setBeforeSessionInvalidate(() => {
          phases.push("beforeSessionInvalidate");
          expect(oldSession.extensionRunner.createContext().cwd).toBe(
            oldSession.sessionManager.getCwd(),
          );
        });
        runtimeHost.setRebindSession(() =>
          effectRunPromise(
            Effect.sync(() => {
              phases.push("rebindSession");
            }),
          ),
        );

        yield* awaited(runtimeHost.newSession());

        expect(phases).toEqual(["session_shutdown", "beforeSessionInvalidate", "rebindSession"]);
        expect(() => oldSession.extensionRunner.createContext().cwd).toThrow(
          "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
        );
        runtimeHost.setBeforeSessionInvalidate(undefined);
        runtimeHost.setRebindSession(undefined);
      }),
    ));
});
