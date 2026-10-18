import * as NodeServices from "@effect/platform-node/NodeServices";
import { fauxAssistantMessage, registerFauxProvider } from "@msa/ai/compat";
import { joinPath } from "@msa/testing";
import { Effect, Exit, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from "../../../src/core/agent-session-runtime.ts";
import type { AgentSession } from "../../../src/core/agent-session.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { ModelRuntime } from "../../../src/core/model-runtime.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionFactory,
} from "../../../src/index.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

function getText(message: AgentSession["messages"][number]): string {
  if (!("content" in message)) {
    return "";
  }
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");
}

const cleanups: Array<() => Promise<void> | void> = [];

function createRuntimeForTest(extensionFactory: ExtensionFactory, responses: string[]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const tempDir = yield* fs.makeTempDirectory({ prefix: `msa-2860-` });
      yield* fs.makeDirectory(tempDir, { recursive: true });

      const faux = registerFauxProvider({
        models: [{ id: "faux-1", reasoning: false }],
      });
      faux.setResponses(responses.map((response) => fauxAssistantMessage(response)));

      const authStorage = AuthStorage.inMemory();
      yield* Effect.promise(() =>
        authStorage.modify(faux.getModel().provider, () =>
          Promise.resolve({
            type: "api_key",
            key: "faux-key",
          }),
        ),
      );
      const modelRuntime = yield* Effect.promise(() =>
        ModelRuntime.create({
          credentials: authStorage,
          modelsPath: joinPath(tempDir, "models.json"),
        }),
      );

      const createRuntime: CreateAgentSessionRuntimeFactory = ({
        cwd,
        sessionManager,
        sessionStartEvent,
      }) =>
        runPromise(
          Effect.gen(function* () {
            const services = yield* Effect.promise(() =>
              createAgentSessionServices({
                cwd,
                agentDir: tempDir,
                modelRuntime,
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
              }),
            );
            return {
              ...(yield* Effect.promise(() =>
                createAgentSessionFromServices({
                  services,
                  sessionManager,
                  ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
                  model: faux.getModel(),
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

      const rebindSession = (): Promise<void> =>
        runPromise(
          Effect.gen(function* () {
            const session = runtime.session;
            yield* Effect.promise(() =>
              session.bindExtensions({
                commandContextActions: {
                  waitForIdle: () => session.agent.waitForIdle(),
                  newSession: (options) => Promise.resolve(runtime.newSession(options)),
                  fork: (entryId, options) =>
                    runPromise(
                      Effect.gen(function* () {
                        const result = yield* Effect.promise(() => runtime.fork(entryId, options));
                        return { cancelled: result.cancelled };
                      }),
                    ),
                  navigateTree: (targetId, options) =>
                    runPromise(
                      Effect.gen(function* () {
                        const result = yield* Effect.promise(() =>
                          session.navigateTree(targetId, {
                            ...(options?.summarize === undefined
                              ? {}
                              : { summarize: options.summarize }),
                            ...(options?.customInstructions === undefined
                              ? {}
                              : { customInstructions: options.customInstructions }),
                            ...(options?.replaceInstructions === undefined
                              ? {}
                              : { replaceInstructions: options.replaceInstructions }),
                            ...(options?.label === undefined ? {} : { label: options.label }),
                          }),
                        );
                        return { cancelled: result.cancelled };
                      }),
                    ),
                  switchSession: (sessionPath, options) =>
                    Promise.resolve(runtime.switchSession(sessionPath, options)),
                  reload: () => session.reload(),
                },
              }),
            );
          }),
        );

      runtime.setRebindSession(() => rebindSession());
      yield* Effect.promise(() => rebindSession());

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

      return { runtime, faux };
    }),
  );
}

const rebindsBeforeWithsessionTargetsTheReplacement = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const events: string[] = [];
  let oldCtx: ExtensionCommandContext | undefined;
  let oldPi: ExtensionAPI | undefined;
  let oldSessionFile: string | undefined;
  let staleCtxThrows = false;
  let staleMsaThrows = false;
  let replacementSessionFile: string | undefined;
  let instanceId = 0;
  const { runtime } = yield* Effect.promise(() =>
    createRuntimeForTest(
      (msa) => {
        const currentInstance = ++instanceId;
        msa.on("session_start", () => {
          events.push(`start:${currentInstance}`);
        });
        msa.on("session_shutdown", () => {
          events.push(`shutdown:${currentInstance}`);
        });
        msa.registerCommand("repro", {
          description: "repro",
          handler: (_args, ctx) =>
            runPromise(
              Effect.gen(function* () {
                oldCtx = ctx;
                oldPi = msa;
                oldSessionFile = ctx.sessionManager.getSessionFile();
                yield* Effect.promise(() =>
                  ctx.newSession({
                    ...(oldSessionFile === undefined ? {} : { parentSession: oldSessionFile }),
                    withSession: (replacedCtx) =>
                      runPromise(
                        Effect.gen(function* () {
                          events.push(`with:${currentInstance}`);
                          replacementSessionFile = replacedCtx.sessionManager.getSessionFile();
                          const staleCtxExit = yield* Effect.exit(
                            Effect.sync(() => oldCtx?.sessionManager.getSessionFile()),
                          );
                          if (Exit.isFailure(staleCtxExit)) staleCtxThrows = true;
                          const staleMsaExit = yield* Effect.exit(
                            Effect.sync(() => oldPi?.sendUserMessage("stale message")),
                          );
                          if (Exit.isFailure(staleMsaExit)) staleMsaThrows = true;
                          yield* Effect.promise(() =>
                            replacedCtx.sendUserMessage("Hello from the new session!"),
                          );
                        }),
                      ),
                  }),
                );
              }),
            ),
        });
      },
      ["hello reply"],
    ),
  );

  expect(events).toEqual(["start:1"]);

  yield* Effect.promise(() => runtime.session.prompt("/repro"));

  expect(events).toEqual(["start:1", "shutdown:1", "start:2", "with:1"]);
  expect(replacementSessionFile).toBeDefined();
  expect(replacementSessionFile).not.toBe(oldSessionFile);
  expect(staleCtxThrows).toBe(true);
  expect(staleMsaThrows).toBe(true);
  expect(
    runtime.session.messages
      .filter((message) => message.role !== "system")
      .map((message) => `${message.role}:${getText(message)}`),
  ).toEqual(["user:Hello from the new session!", "assistant:hello reply"]);
});

const supportsWithsessionForFork = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const { runtime } = yield* Effect.promise(() =>
    createRuntimeForTest(
      (msa) => {
        msa.registerCommand("fork-it", {
          description: "fork-it",
          handler: (_args, ctx) =>
            runPromise(
              Effect.gen(function* () {
                const leafId = ctx.sessionManager.getLeafId();
                if (leafId === null || leafId === "") {
                  throw new Error("Missing leaf id");
                }
                yield* Effect.promise(() =>
                  ctx.fork(leafId, {
                    position: "at",
                    withSession: (replacedCtx) =>
                      replacedCtx.sendUserMessage("fork callback message"),
                  }),
                );
              }),
            ),
        });
      },
      ["seed reply", "fork reply"],
    ),
  );

  yield* Effect.promise(() => runtime.session.prompt("seed"));
  yield* Effect.promise(() => runtime.session.prompt("/fork-it"));

  expect(
    runtime.session.messages
      .filter((message) => message.role !== "system")
      .map((message) => `${message.role}:${getText(message)}`),
  ).toEqual([
    "user:seed",
    "assistant:seed reply",
    "user:fork callback message",
    "assistant:fork reply",
  ]);
});

const supportsWithsessionForSwitchsession = Effect.gen(function* () {
  let targetSessionPath = "";
  const { runtime } = yield* Effect.promise(() =>
    createRuntimeForTest(
      (msa) => {
        msa.registerCommand("switch-it", {
          description: "switch-it",
          handler: (_args, ctx) =>
            ctx
              .switchSession(targetSessionPath, {
                withSession: (replacedCtx) =>
                  Promise.resolve(replacedCtx.sendUserMessage("switch callback message")).then(
                    () => undefined,
                  ),
              })
              .then(() => undefined),
        });
      },
      ["root reply", "target reply", "switch reply"],
    ),
  );

  yield* Effect.promise(() => runtime.session.prompt("root"));
  const originalSessionPath = runtime.session.sessionFile;
  const newSessionResult = yield* Effect.promise(() => runtime.newSession());
  expect(newSessionResult.cancelled).toBe(false);
  yield* Effect.promise(() => runtime.session.prompt("target"));
  targetSessionPath = runtime.session.sessionFile!;
  yield* Effect.promise(() => runtime.switchSession(originalSessionPath!));

  yield* Effect.promise(() => runtime.session.prompt("/switch-it"));

  expect(runtime.session.sessionFile).toBe(targetSessionPath);
  expect(
    runtime.session.messages
      .filter((message) => message.role !== "system")
      .map((message) => `${message.role}:${getText(message)}`),
  ).toEqual([
    "user:target",
    "assistant:target reply",
    "user:switch callback message",
    "assistant:switch reply",
  ]);
});

describe("regression #2860: replaced session callbacks", () => {
  afterEach(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        while (cleanups.length > 0) {
          yield* Effect.promise(() => Promise.resolve(cleanups.pop()?.()));
        }
      }),
    ),
  );
  it("rebinds before withSession, targets the replacement session, and invalidates stale msa/ctx", () =>
    Effect.runPromise(rebindsBeforeWithsessionTargetsTheReplacement));
  it("supports withSession for fork", () => Effect.runPromise(supportsWithsessionForFork));
  it("supports withSession for switchSession", () =>
    Effect.runPromise(supportsWithsessionForSwitchsession));
});
