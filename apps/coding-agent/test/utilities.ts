import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";

import { Agent } from "@msa/agent-core";
import { getModel, streamSimple } from "@msa/ai/compat";
import {
  awaited,
  currentTimeMillis,
  joinPath,
  randomSuffixSync,
  runTest,
  tempPath,
} from "@msa/testing";
import { Effect } from "effect";
import { dual } from "effect/Function";

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
import { readEnv } from "../src/core/process-env.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createCodingTools } from "../src/index.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

export const API_KEY = readEnv("ANTHROPIC_OAUTH_TOKEN") || readEnv("ANTHROPIC_API_KEY");

export const MSA_AGENT_DIR = joinPath(homedir(), ".msa", "agent");

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

export function readSessionFileRoles(file: string): string[] {
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .map((line) => {
      const record = JSON.parse(line);
      return record.message?.role ?? record.type;
    });
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

export const createTestExtensionsResult: {
  (inputs: TestExtensionInput[], cwd?: string): Promise<LoadExtensionsResult>;
  (cwd?: string): (inputs: TestExtensionInput[]) => Promise<LoadExtensionsResult>;
} = dual(
  () => true,
  (inputs: TestExtensionInput[], cwd: string = process.cwd()): Promise<LoadExtensionsResult> =>
    runTest(
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
            yield* awaited(
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
    ),
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
    reload: () => runTest(Effect.void),
  };
}

export function createTestSession(options: TestSessionOptions = {}): Promise<TestSessionContext> {
  return runTest(
    Effect.gen(function* () {
      const tempDir = tempPath(`msa-test-${currentTimeMillis()}-${randomSuffixSync()}`);
      mkdirSync(tempDir, { recursive: true });

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
      const modelRegistry = yield* awaited(createModelRegistry(authStorage, tempDir));

      const session = new AgentSession({
        agent,
        sessionManager,
        settingsManager,
        cwd: tempDir,
        modelRuntime: getModelRuntime(modelRegistry),
        resourceLoader: createTestResourceLoader(),
      });

      session.subscribe(() => {});

      const cleanup = () => {
        session.dispose();
        if (tempDir.length > 0 && existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true });
        }
      };

      return { session, sessionManager, tempDir, cleanup };
    }),
  );
}

export const buildTestTree: {
  (
    session: SessionManager,
    structure: {
      messages: Array<{ role: "user" | "assistant"; text: string; branchFrom?: string }>;
    },
  ): Map<string, string>;
  (structure: {
    messages: Array<{ role: "user" | "assistant"; text: string; branchFrom?: string }>;
  }): (session: SessionManager) => Map<string, string>;
} = dual(2, buildTestTreeImpl);

function buildTestTreeImpl(
  session: SessionManager,
  structure: {
    messages: Array<{ role: "user" | "assistant"; text: string; branchFrom?: string }>;
  },
): Map<string, string> {
  const ids = new Map<string, string>();

  for (const msg of structure.messages) {
    if (msg.branchFrom !== undefined) {
      const branchFromId = ids.get(msg.branchFrom);
      if (branchFromId === undefined) {
        throw new Error(`Cannot branch from unknown entry: ${msg.branchFrom}`);
      }
      session.branch(branchFromId);
    }

    const id =
      msg.role === "user"
        ? session.appendMessage(userMsg(msg.text))
        : session.appendMessage(assistantMsg(msg.text));

    ids.set(msg.text, id);
  }

  return ids;
}
