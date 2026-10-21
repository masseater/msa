import { tmpdir } from "node:os";

import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import sdk from "../src/core/sdk.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import type settingsManagerTypes from "../src/core/settings-manager.types.ts";
import bash from "../src/core/tools/bash.ts";
import codingAgent from "../src/index.ts";

const { DefaultResourceLoader, SessionManager, SettingsManager } = codingAgent;

const { createBashTool } = bash;
const { createAgentSession } = sdk;

const { getModel } = compat;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  removePath,
  runTest,
} = testing;

let tempDir: string;

let agentDir: string;

const exposesSessionStateBeforeCustomBashSpawnStep1 = () =>
  Effect.gen(function* () {
    const settingsManager = yield* Effect.promise(() => SettingsManager.create(tempDir, agentDir));
    const sessionManager = SessionManager.create(tempDir, joinPath(agentDir, "sessions"), {
      id: "bash-env-test",
    });
    return { sessionManager, settingsManager };
  });

const exposesSessionStateBeforeCustomBashSpawnStep2 = (context0: {
  readonly args: {
    readonly carried: {
      readonly input: {
        readonly sessionManager: sessionManagerTypes.SessionManager;
        readonly settingsManager: settingsManagerTypes.SettingsManager;
      };
    };
  };
}) =>
  Effect.sync(() => {
    const { args } = context0;
    const { carried } = args;
    const { input } = carried;
    const { settingsManager, sessionManager } = input;
    return { sessionManager, settingsManager };
  });

const sessionEnvNames = [
  "MSA_SESSION_ID",
  "MSA_SESSION_FILE",
  "MSA_PROVIDER",
  "MSA_MODEL",
  "MSA_REASONING_LEVEL",
];

type CapturedEnvs = { optedOut?: NodeJS.ProcessEnv; session?: NodeJS.ProcessEnv };

type ExtensionFactory = NonNullable<
  ConstructorParameters<typeof DefaultResourceLoader>[0]["extensionFactories"]
>[number];

const registerCapturingBashTools =
  (envs: CapturedEnvs): ExtensionFactory =>
  (msa) => {
    msa.registerTool(
      createBashTool(tempDir, {
        spawnHook: (ctx) => {
          envs.session = ctx.env;
          return ctx;
        },
      }),
    );
    msa.registerTool({
      ...createBashTool(tempDir, {
        exposeSessionEnvironment: false,
        spawnHook: (ctx) => {
          envs.optedOut = ctx.env;
          return ctx;
        },
      }),
      label: "bash without session env",
      name: "bash_without_session_env",
    });
  };

const exposesSessionStateBeforeCustomBashSpawnStep3 = (input: {
  readonly sessionManager: sessionManagerTypes.SessionManager;
  readonly settingsManager: settingsManagerTypes.SettingsManager;
}) =>
  Effect.gen(function* () {
    const { sessionManager, settingsManager } = input;
    const envs: CapturedEnvs = {};
    const resourceLoader = new DefaultResourceLoader({
      agentDir,
      cwd: tempDir,
      extensionFactories: [registerCapturingBashTools(envs)],
      settingsManager,
    });
    yield* awaited(resourceLoader.reload());

    const model = getModel("anthropic-api", "claude-sonnet-4-5")!;
    const { session } = yield* awaited(
      createAgentSession({
        agentDir,
        cwd: tempDir,
        model,
        resourceLoader,
        sessionManager,
        settingsManager,
        thinkingLevel: "high",
      }),
    );

    const bashTool = session.agent.state.tools.find((tool) => tool.name === "bash")!;
    expect(session.tools.prompt.systemPrompt).toContain(
      "You can inspect MSA_* environment variables for current model and session details.",
    );
    yield* awaited(bashTool.execute("bash-env", { command: "printf ok" }));
    expect(envs.session).toMatchObject({
      MSA_MODEL: model.id,
      MSA_PROVIDER: model.provider,
      MSA_REASONING_LEVEL: session.thinkingLevel,
      MSA_SESSION_FILE: session.sessionFile,
      MSA_SESSION_ID: session.sessionId,
    });

    const optedOutBashTool = session.agent.state.tools.find(
      (tool) => tool.name === "bash_without_session_env",
    )!;
    yield* awaited(optedOutBashTool.execute("bash-no-env", { command: "printf ok" }));
    for (const name of sessionEnvNames) expect(envs.optedOut).not.toHaveProperty(name);
    return { session };
  });

const exposesSessionStateBeforeCustomBashSpawnStep4 = (args: {
  readonly carried: {
    readonly input: {
      readonly sessionManager: sessionManagerTypes.SessionManager;
      readonly settingsManager: settingsManagerTypes.SettingsManager;
    };
  };
}) =>
  Effect.gen(function* () {
    const { sessionManager, settingsManager } =
      yield* exposesSessionStateBeforeCustomBashSpawnStep2({ args });
    const { session } = yield* exposesSessionStateBeforeCustomBashSpawnStep3({
      sessionManager,
      settingsManager,
    });
    return { session };
  });

const exposesSessionStateBeforeCustomBashSpawnStep5 = (carried: {
  readonly input: {
    readonly sessionManager: sessionManagerTypes.SessionManager;
    readonly settingsManager: settingsManagerTypes.SettingsManager;
  };
}) =>
  Effect.gen(function* () {
    const { session } = yield* exposesSessionStateBeforeCustomBashSpawnStep4({ carried });
    return { session };
  });

const exposesSessionStateBeforeCustomBashSpawnStep6 = (input: {
  readonly sessionManager: sessionManagerTypes.SessionManager;
  readonly settingsManager: settingsManagerTypes.SettingsManager;
}) =>
  Effect.gen(function* () {
    const { session } = yield* exposesSessionStateBeforeCustomBashSpawnStep5({ input });
    return { session };
  });

const exposesSessionStateBeforeCustomBashSpawn = Effect.gen(function* () {
  const { sessionManager, settingsManager } =
    yield* exposesSessionStateBeforeCustomBashSpawnStep1();
  const { session } = yield* exposesSessionStateBeforeCustomBashSpawnStep6({
    sessionManager,
    settingsManager,
  });

  session.dispose();
});

const beforeEachHook = Effect.gen(function* () {
  tempDir = joinPath(
    tmpdir(),
    `msa-dynamic-tool-test-${currentTimeMillis()}-${randomSuffixSync()}`,
  );
  agentDir = joinPath(tempDir, "agent");
  yield* makeDirectory(agentDir);
});

const afterEachHook = Effect.gen(function* () {
  if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
    yield* removePath(tempDir);
  }
});

describe("AgentSession dynamic tool registration", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(afterEachHook));

  it("exposes session state before custom bash spawn hooks and supports opting out", () =>
    runTest(exposesSessionStateBeforeCustomBashSpawn));
});
