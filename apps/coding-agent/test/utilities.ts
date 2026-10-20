import testing from "@msa/testing";
import { Config, Effect, Function, Option } from "effect";

import { createEventBus } from "../src/core/event-bus.ts";
import type {
  Extension,
  InlineExtension,
  LoadExtensionsResult,
} from "../src/core/extensions/index.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import type utilitiesTypes from "./utilities.types.ts";

const { currentTimeMillis, fromJsonText, readTextFile, runTest } = testing;

const readEnv = (name: string): string | undefined =>
  Option.getOrUndefined(Effect.runSync(Config.option(Config.String(name))));

const API_KEY = readEnv("ANTHROPIC_OAUTH_TOKEN") ?? readEnv("ANTHROPIC_API_KEY");

function userMsg(text: string) {
  return { content: text, role: "user" as const, timestamp: currentTimeMillis() };
}

function assistantMsg(text: string) {
  return {
    api: "anthropic-messages" as const,
    content: [{ text, type: "text" as const }],
    model: "test",
    provider: "anthropic-api",
    role: "assistant" as const,
    stopReason: "stop" as const,
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 1,
      output: 1,
      totalTokens: 2,
    },
  };
}

const roleOf = (line: string) =>
  Effect.map(fromJsonText(line), (value) => {
    const record = value as { message?: { role?: string }; type?: string };
    return record.message?.role ?? record.type ?? "";
  });

const readSessionFileRoles = (file: string): Promise<string[]> =>
  runTest(
    Effect.flatMap(readTextFile(file), (content) =>
      Effect.forEach(content.trim().split("\n"), roleOf),
    ),
  );

type TestExtensionInput = InlineExtension | utilitiesTypes.CreateTestExtensionsResultInput;

const createTestExtensionsResultImpl = (
  inputs: TestExtensionInput[],
  cwd = process.cwd(),
): Promise<LoadExtensionsResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const extensionRuntime = createExtensionRuntime();
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
            loadExtensionFromFactory(factory, cwd, eventBus, extensionRuntime, extensionPath),
          ),
        );
      }

      return {
        errors: [],
        extensions,
        runtime: extensionRuntime,
      };
    }),
  );

const createTestExtensionsResult: {
  (cwd?: string): (inputs: TestExtensionInput[]) => Promise<LoadExtensionsResult>;
  (inputs: TestExtensionInput[], cwd?: string): Promise<LoadExtensionsResult>;
} = Function.dual(
  (args) => args.length >= 2 || Array.isArray(args[0]),
  createTestExtensionsResultImpl,
);

function createTestResourceLoader(
  options: utilitiesTypes.CreateTestResourceLoaderOptions = {},
): ResourceLoader {
  const extensionsResult = options.extensionsResult ?? {
    errors: [],
    extensions: options.extensions ?? [],
    runtime: createExtensionRuntime(),
  };

  return {
    extendResources: () => {},
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    getExtensions: () => extensionsResult,
    getPrompts: () => ({ diagnostics: [], prompts: [] }),
    getSkills: () => ({ diagnostics: [], skills: [] }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getThemes: () => ({ diagnostics: [], themes: [] }),
    reload: () => Promise.resolve(),
  };
}

const utilities = {
  API_KEY,
  assistantMsg,
  createTestExtensionsResult,
  createTestResourceLoader,
  readSessionFileRoles,
  userMsg,
};

export default utilities;
