import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import eventBusModule from "../src/core/event-bus.ts";
import ExtensionRunner from "../src/core/extensions/extension-runner.ts";
import loader from "../src/core/extensions/loader.ts";
import systemPrompt from "../src/core/system-prompt.ts";
import extensionsRunnerEnv from "./extensions-runner-env.ts";
import extensionsRunnerSupport from "./extensions-runner-support.ts";

const { createExtensionRuntime, discoverAndLoadExtensions, loadExtensionFromFactory } = loader;
const { buildSystemPrompt } = systemPrompt;
const { createEventBus } = eventBusModule;

const { cleanupRunnerEnv, env, prepareRunnerEnv } = extensionsRunnerEnv;

const { extensionActions, extensionContextActions } = extensionsRunnerSupport;

const { awaited, joinPath, runTest, writeTextFile } = testing;

const keepsCtxGetsystempromptInSyncWithChainedSetup = () =>
  Effect.sync(() => {
    const extCode1 = `
				export default function(msa) {
					msa.on("before_agent_start", async (_event, ctx) => {
						return {
							systemPrompt: ctx.getSystemPrompt() + "\\nfirst",
						};
					});
				}
			`;
    return { extCode1 };
  });

const keepsCtxGetsystempromptInSyncWithChained = Effect.gen(function* () {
  const { extCode1 } = yield* keepsCtxGetsystempromptInSyncWithChainedSetup();
  const extCode2 = `
				export default function(msa) {
					msa.on("before_agent_start", async (_event, ctx) => {
						return {
							systemPrompt: ctx.getSystemPrompt() + "\\nsecond",
						};
					});
				}
			`;
  yield* writeTextFile(joinPath(env.extensionsDir, "before-agent-start-1.ts"), extCode1);
  yield* writeTextFile(joinPath(env.extensionsDir, "before-agent-start-2.ts"), extCode2);

  const result = yield* awaited(discoverAndLoadExtensions([], env.tempDir, env.tempDir));
  expect(result.errors).toEqual([]);
  expect(result.extensions).toHaveLength(2);
  const runner = new ExtensionRunner(
    result.extensions,
    result.runtime,
    env.tempDir,
    env.sessionManager,
    env.modelRegistry,
  );
  const errors: string[] = [];
  runner.onError((error) => errors.push(error.error));
  runner.bindCore(extensionActions, extensionContextActions);

  const chained = yield* awaited(
    runner.emitBeforeAgentStart(
      { messageType: "user", prompt: "hello" },
      {
        customPrompt: "base",
        cwd: env.tempDir,
      },
    ),
  );

  expect(errors).toEqual([]);
  expect(chained.messages).toEqual([]);
  expect(buildSystemPrompt(chained.systemPromptOptions)).toMatch(/base[\s\S]*\nfirst\nsecond$/u);
});

const resolvesToolRenderersInExtensionLoadOrder = Effect.gen(function* () {
  const runtime = createExtensionRuntime(() => ({}));
  const eventBus = createEventBus();
  const renderCall = () => ({ invalidate: () => {}, render: () => [] });
  const first = yield* awaited(
    loadExtensionFromFactory(
      (msa) =>
        msa.registerToolRenderer((toolName, next) => (toolName === "a" ? { renderCall } : next())),
      env.tempDir,
      eventBus,
      runtime,
    ),
  );
  const second = yield* awaited(
    loadExtensionFromFactory(
      (msa) => msa.registerToolRenderer((_toolName, next) => next() ?? { renderShell: "self" }),
      env.tempDir,
      eventBus,
      runtime,
    ),
  );
  const runner = new ExtensionRunner(
    [first, second],
    runtime,
    env.tempDir,
    env.sessionManager,
    env.modelRegistry,
  );

  expect(runner.resolveToolRenderers("a", () => undefined)).toEqual({ renderCall });
  expect(runner.resolveToolRenderers("b", () => undefined)).toEqual({ renderShell: "self" });
  expect(runner.resolveToolRenderers("b", () => ({ renderCall }))).toEqual({ renderCall });
});

describe("ExtensionRunner", () => {
  beforeEach(() => runTest(prepareRunnerEnv));

  afterEach(cleanupRunnerEnv);

  describe("before_agent_start", () => {
    it("keeps ctx.getSystemPrompt() in sync with chained system prompt updates", () =>
      runTest(keepsCtxGetsystempromptInSyncWithChained));
  });

  it("resolves tool renderers in extension load order, each able to defer to the next", () =>
    runTest(resolvesToolRenderersInExtensionLoadOrder));
});
