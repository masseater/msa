import * as NodeServices from "@effect/platform-node/NodeServices";
import { Agent } from "@msa/agent-core";
import { getModel, streamSimple } from "@msa/ai/compat";
import { currentTimeMillis, joinPath } from "@msa/testing";
import { Config, Effect, FileSystem, Function, ManagedRuntime, Option } from "effect";

import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import type {
  Extension,
  ExtensionFactory,
  InlineExtension,
  LoadExtensionsResult,
} from "../src/core/extensions/index.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createCodingTools } from "../src/index.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const readEnv = (name: string): string | undefined =>
  Option.getOrUndefined(Effect.runSync(Config.option(Config.String(name))));

export const API_KEY = readEnv("ANTHROPIC_OAUTH_TOKEN") ?? readEnv("ANTHROPIC_API_KEY");

export function userMsg(text: string) {
  return { role: "user" as const, content: text, timestamp: currentTimeMillis() };
}

export function assistantMsg(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages" as const,
    provider: "anthropic",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: currentTimeMillis(),
  };
}

export function readSessionFileRoles(file: string): Promise<string[]> {
  return runtime.runPromise(
    fs.readFileString(file).pipe(
      Effect.map((content) =>
        content
          .trim()
          .split("\n")
          .map((line) => {
            const record = JSON.parse(line) as { message?: { role?: string }; type?: string };
            return record.message?.role ?? record.type ?? "";
          }),
      ),
    ),
  );
}

export interface TestSessionOptions {
  inMemory?: boolean;

  systemPrompt?: string;

  settingsOverrides?: Record<string, unknown>;
}

export interface TestSessionContext {
  session: AgentSession;
  sessionManager: SessionManager;
  tempDir: string;
  cleanup: () => void;
}

export interface CreateTestExtensionsResultInput {
  factory: ExtensionFactory;
  path?: string;
}

type TestExtensionInput = InlineExtension | CreateTestExtensionsResultInput;

const createTestExtensionsResultImpl = (
  inputs: TestExtensionInput[],
  cwd = process.cwd(),
): Promise<LoadExtensionsResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = createExtensionRuntime();
      const eventBus = createEventBus();
      const extensions: Extension[] = [];

      for (const [index, input] of inputs.entries()) {
        const isObject = typeof input !== "function";
        const hasName = isObject && "name" in input;
        const hasPath =
          isObject && "path" in input && typeof input.path === "string" && input.path !== "";
        const factory = isObject ? input.factory : input;
        const extensionPath = hasName
          ? `<inline:${input.name}>`
          : hasPath
            ? input.path
            : `<inline:${index + 1}>`;

        extensions.push(
          yield* Effect.promise(() =>
            loadExtensionFromFactory(factory, cwd, eventBus, runtime, extensionPath),
          ),
        );
      }

      return {
        extensions,
        errors: [],
        runtime,
      };
    }),
  );

export const createTestExtensionsResult: {
  (cwd?: string): (inputs: TestExtensionInput[]) => Promise<LoadExtensionsResult>;
  (inputs: TestExtensionInput[], cwd?: string): Promise<LoadExtensionsResult>;
} = Function.dual(
  (args) => args.length >= 2 || Array.isArray(args[0]),
  createTestExtensionsResultImpl,
);

export interface CreateTestResourceLoaderOptions {
  extensionsResult?: LoadExtensionsResult;
}

export function createTestResourceLoader(
  options: CreateTestResourceLoaderOptions = {},
): ResourceLoader {
  const extensionsResult = options.extensionsResult ?? {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };

  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: () => Effect.runPromise(Effect.sync(() => {})),
  };
}

export function createTestSession(options: TestSessionOptions = {}): Promise<TestSessionContext> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* fs.makeTempDirectory({ prefix: `msa-test-` });
      yield* fs.makeDirectory(tempDir, { recursive: true });

      const model = getModel("anthropic", "claude-sonnet-4-5")!;
      const agent = new Agent({
        getApiKey: () => API_KEY,
        initialState: {
          model,
          systemPrompt:
            options.systemPrompt ?? "You are a helpful assistant. Be extremely concise.",
          tools: createCodingTools(process.cwd()),
        },
        streamFn: streamSimple,
      });

      const sessionManager =
        options.inMemory === true ? SessionManager.inMemory() : SessionManager.create(tempDir);
      const settingsManager = SettingsManager.create(tempDir, tempDir);

      if (options.settingsOverrides !== undefined) {
        settingsManager.applyOverrides(options.settingsOverrides);
      }

      const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
      const modelRegistry = yield* Effect.promise(() => createModelRegistry(authStorage, tempDir));

      const session = new AgentSession({
        agent,
        sessionManager,
        settingsManager,
        cwd: tempDir,
        modelRuntime: getModelRuntime(modelRegistry),
        resourceLoader: createTestResourceLoader(),
      });

      session.subscribe(() => {});

      const cleanup = () =>
        runtime.runPromise(
          Effect.gen(function* () {
            session.dispose();
            if (tempDir !== "" && (yield* fs.exists(tempDir))) {
              yield* fs.remove(tempDir, { recursive: true });
            }
          }),
        );

      return { session, sessionManager, tempDir, cleanup };
    }),
  );
}
